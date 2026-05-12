#include <Wire.h>
#include <SPI.h>
#include <mcp_can.h>
#include <Adafruit_ADS1X15.h>
#include <PCF8574.h>
#include <freertos/semphr.h> // Untuk Mutex

// =====================================================
// WIRING
// =====================================================
// ADS (alamat swap):
//   ADS48_ADDR=0x49 : A0 MAP, A1 TPS, A2 ECT/WTS, A3 IAT
//   ADS49_ADDR=0x48 : A0 O2,  A1 KNOCK, A2 POT,    A3 Spare
// PCF20(0x20) AKTIF LOW: INJ1..4=P0..P3, COIL1..4=P4..P7
// PCF21(0x21) AKTIF HIGH: ISC A..D=P0..P3, MIL=P4, FUEL=P5, FAN=P6
// CKP GEN OUT=GPIO16, CKP IN=GPIO27, CMP IN=GPIO34
// VVTI Sense=GPIO25, VVTI PWM=GPIO33
// REV OUT=GPIO14, L298 ENA PWM=GPIO32
// MCP2515: CS=5 INT=4 SPI(18/19/23)
// =====================================================

// ================= I2C Address =================
#define ADS48_ADDR  0x49
#define ADS49_ADDR  0x48
#define PCF20_ADDR  0x20
#define PCF21_ADDR  0x21

// ================= CKP/CMP =================
#define CKP_GEN_PIN  16
#define CKP_IN_PIN   27
#define CMP_IN_PIN   34
static const uint8_t CKP_SLOTS_TOTAL = 33;
static const uint8_t CKP_MISSING     = 3;

// ================= VVTI / REV / L298 =================
#define VVTI_SENSE_PIN 25
#define VVTI_PWM_PIN   33
#define REV_OUT_PIN    14
#define L298_ENA_PWM   32

// ================= MCP2515 CAN =================
#define CAN_CS     5
#define CAN_INT    4
#define CAN_SPEED  CAN_500KBPS
#define CAN_CLOCK  MCP_8MHZ
MCP_CAN CAN0(CAN_CS);

// OBD CAN IDs
static const uint16_t REQ_FUNC_ID  = 0x7DF;
static const uint16_t REQ_PHYS_MIN = 0x7E0;
static const uint16_t REQ_PHYS_MAX = 0x7E7;

// ================= PCF Expanders =================
PCF8574 pcf20(PCF20_ADDR);  // AKTIF LOW (INJ/COIL)
PCF8574 pcf21(PCF21_ADDR);  // AKTIF HIGH (ISC + LAMPS)

// PCF20 mapping (AKTIF LOW)
enum {
  PIN_INJ1 = 0, PIN_INJ2 = 1, PIN_INJ3 = 2, PIN_INJ4 = 3,
  PIN_COIL1= 4, PIN_COIL2= 5, PIN_COIL3= 6, PIN_COIL4= 7
};
// PCF21 mapping (AKTIF HIGH)
enum {
  PIN_ISC_A = 0, PIN_ISC_B = 1, PIN_ISC_C = 2, PIN_ISC_D = 3,
  PIN_MIL   = 4, PIN_FUEL  = 5, PIN_FAN   = 6, PIN_SPARE = 7
};

// PCF21 spare pin used as START/STA input
#define STA_PCF_PIN   PIN_SPARE
#define STA_PULSE_MS  100

// ================= ADS Objects =================
Adafruit_ADS1115 ads48;
Adafruit_ADS1115 ads49;

// =====================================================
// VISUAL mode (relay/LED)
// =====================================================
#define VISUAL_PULSE_MODE        1
#define VISUAL_MIN_INJ_ON_US     10000UL   // 10ms
#define VISUAL_MIN_COIL_ON_US    8000UL    // 8ms
#define VISUAL_MAX_ON_FRACTION   0.80f

// =====================================================
// SENSOR COPOT berdasarkan TEGANGAN
// =====================================================
static inline int16_t adsReadCh(Adafruit_ADS1115 &ads, uint8_t ch){
  I2C_LOCK();
  int16_t v = ads.readADC_SingleEnded(ch);
  I2C_UNLOCK();
  return v;
}
static inline float adsRawToVolt(int16_t raw) { return (float)raw * 0.000125f; }
static inline int16_t voltToAdsRaw(float v) {
  int32_t r = (int32_t)lroundf(v / 0.000125f);
  if (r > 32767) r = 32767;
  if (r < -32768) r = -32768;
  return (int16_t)r;
}

// Offsets Trainer (Unit: kPa, %, C, mV)
volatile int32_t off_map_kpa = 0;
volatile int32_t off_tps_pct = 0;
volatile int32_t off_wts_c   = 0;
volatile int32_t off_iat_c   = 0;
volatile int32_t off_o2_mV   = 0;
volatile int32_t off_knk_mV  = 0;
volatile int32_t off_rpm     = 0;
volatile int32_t off_vvti_pct= 0;
volatile int32_t off_isc_pct = 0;

// simple linear trainer maps
static inline float v_to_map_kpa(float v){ return (v / 4.096f) * 300.0f; }
static inline float v_to_pct(float v){ return (v / 4.096f) * 100.0f; }
static inline float v_to_ect_c(float v){ return (v / 4.096f) * 120.0f; }
static inline float v_to_iat_c(float v){ return (v / 4.096f) * 100.0f; }

static inline float map_kpa_to_v(float kpa){ return (kpa / 300.0f) * 4.096f; }
static inline float pct_to_v(float pct){ return (pct / 100.0f) * 4.096f; }
static inline float ect_c_to_v(float c){ return (c / 120.0f) * 4.096f; }
static inline float iat_c_to_v(float c){ return (c / 100.0f) * 4.096f; }

const float FLOAT_V1_MIN = 0.50f;
const float FLOAT_V1_MAX = 0.60f;
const float FLOAT_V2_MIN = 0.30f;
const float FLOAT_V2_MAX = 0.36f;

static inline bool isFloating_Generic(float v) { return (v >= FLOAT_V1_MIN && v <= FLOAT_V1_MAX); }
static inline bool isFloating_ECT(float v) {
  return ((v >= FLOAT_V1_MIN && v <= FLOAT_V1_MAX) || (v >= FLOAT_V2_MIN && v <= FLOAT_V2_MAX));
}
static inline bool sensorPresent_Generic(int16_t raw) { return !isFloating_Generic(adsRawToVolt(raw)); }
static inline bool sensorPresent_ECT(int16_t raw)     { return !isFloating_ECT(adsRawToVolt(raw)); }

// =====================================================
// Pot -> RPM & L298 PWM
// =====================================================
const int16_t  POT_RAW_MIN   = 0;
const int16_t  POT_RAW_MAX   = 32767;
const uint16_t RPM_MIN = 300;
const uint16_t RPM_MAX = 6000;
const uint8_t  L298_PWM_MIN = 0;
const uint8_t  L298_PWM_MAX = 255;

// =====================================================
// DTC list
// =====================================================
struct DtcEntry { uint8_t hi, lo; const char* label; };
static const DtcEntry DTC_LIST[] = {
  {0x01, 0x06, "MAP      P0106"},
  {0x01, 0x20, "TPS      P0120"},
  {0x01, 0x15, "WTS/ECT  P0115"},
  {0x03, 0x25, "KNOCK    P0325"},
  {0x01, 0x10, "IAT      P0110"},
  {0x01, 0x30, "O2 S1    P0130"},
  {0x03, 0x35, "CKP      P0335"},
  {0x03, 0x40, "CMP      P0340"},
  {0x13, 0x49, "VVTI     P1349"},
  {0x05, 0x05, "ISC/IAC  P0505"},
};
static const uint8_t DTC_COUNT = sizeof(DTC_LIST) / sizeof(DTC_LIST[0]);

static const uint8_t IDX_MAP  = 0;
static const uint8_t IDX_TPS  = 1;
static const uint8_t IDX_WTS  = 2;
static const uint8_t IDX_KNK  = 3;
static const uint8_t IDX_IAT  = 4;
static const uint8_t IDX_O2   = 5;
static const uint8_t IDX_CKP  = 6;
static const uint8_t IDX_CMP  = 7;
static const uint8_t IDX_VVTI = 8;
static const uint8_t IDX_ISC  = 9;

static volatile bool dtcCurrent[DTC_COUNT];
static volatile bool g_forceDtc[DTC_COUNT]; 
static volatile bool dtcStored[DTC_COUNT];

// =====================================================
// Shared State
// =====================================================
static portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
SemaphoreHandle_t g_i2cMutex = nullptr;

static inline void I2C_LOCK(){ 
  if(g_i2cMutex) xSemaphoreTake(g_i2cMutex, portMAX_DELAY); 
}
static inline void I2C_UNLOCK(){ 
  if(g_i2cMutex) xSemaphoreGive(g_i2cMutex); 
}

static volatile bool g_ads48_ok = false;
static volatile bool g_ads49_ok = false;
static volatile bool g_pcf20_ok = false;
static volatile bool g_pcf21_ok = false;

// Simulated Values (Published to system)
static volatile int16_t g_mapRaw=0, g_tpsRaw=0, g_wtsRaw=0, g_iatRaw=0;
static volatile int16_t g_o2Raw=0,  g_knkRaw=0, g_potRaw=0;

// Derived
static volatile uint16_t g_rpmTarget = 1000;
static volatile uint16_t g_rpmLive   = 0;

// CKP/CMP pulse time
static volatile uint32_t g_lastCkpPulseUs = 0;
static volatile uint32_t g_lastCmpPulseUs = 0;
static volatile uint32_t g_ckpPulseCount  = 0;

// START latch
static volatile bool     g_staLatched = false;
static volatile uint32_t g_staHighStartMs = 0;

// ================= FUEL PRIME =================
static const uint32_t FUEL_PRIME_MS = 2000;
static bool     lastStaLatched = false;
static bool     fuelPrimeActive = false;
static uint32_t fuelPrimeStartMs = 0;

// ISO-TP State
static volatile bool g_txIsoTpActive = false; 

// =====================================================
// Helpers
// =====================================================
static inline uint16_t clampU16(long v, uint16_t lo, uint16_t hi) {
  if (v < lo) return lo; if (v > hi) return hi; return (uint16_t)v;
}
static inline uint8_t clampU8(long v, uint8_t lo, uint8_t hi) {
  if (v < lo) return lo; if (v > hi) return hi; return (uint8_t)v;
}
static inline int16_t clampI16(long v, int16_t lo, int16_t hi) {
  if (v < lo) return lo; if (v > hi) return hi; return (int16_t)v;
}
static inline int32_t clampI32(long v, int32_t lo, int32_t hi) {
  if (v < lo) return lo; if (v > hi) return hi; return (int32_t)v;
}

static inline uint16_t rpmFromPot(int16_t raw) {
  raw = (raw < POT_RAW_MIN) ? POT_RAW_MIN : (raw > POT_RAW_MAX ? POT_RAW_MAX : raw);
  long rpm = map((long)raw, POT_RAW_MIN, POT_RAW_MAX, RPM_MIN, RPM_MAX);
  return clampU16(rpm, RPM_MIN, RPM_MAX);
}
static inline uint8_t pwmFromPot(int16_t raw) {
  raw = (raw < POT_RAW_MIN) ? POT_RAW_MIN : (raw > POT_RAW_MAX ? POT_RAW_MAX : raw);
  long pwm = map((long)raw, POT_RAW_MIN, POT_RAW_MAX, L298_PWM_MIN, L298_PWM_MAX);
  return clampU8(pwm, L298_PWM_MIN, L298_PWM_MAX);
}
static inline uint8_t countActive(const volatile bool *arr) {
  uint8_t c=0; for (uint8_t i=0;i<DTC_COUNT;i++) if (arr[i]) c++; return c;
}
static inline uint8_t countUnionDtc() {
  uint8_t c=0;
  for (uint8_t i=0;i<DTC_COUNT;i++) if (dtcStored[i] || dtcCurrent[i]) c++;
  return c;
}
static inline uint16_t calcRespId(uint16_t rxId) {
  if (rxId == REQ_FUNC_ID) return 0x7E8;
  if (rxId >= REQ_PHYS_MIN && rxId <= REQ_PHYS_MAX) return (uint16_t)(rxId + 8);
  return 0x7E8;
}
static inline void pcf21_write(uint8_t pin, bool on) {
  if (!g_pcf21_ok) return;
  I2C_LOCK();
  pcf21.write(pin, on ? HIGH : LOW);
  I2C_UNLOCK();
}

// =====================================================
// PCF20 (INJ/COIL) shadow + flush (OPTIMIZED)
// =====================================================
static uint8_t pcf20Out = 0xFF;
static uint8_t pcf20Pending = 0xFF;
static bool    pcf20Dirty = false;

static inline void pcf20_shadowWrite(uint8_t pin, bool on) {
  if (!g_pcf20_ok) return;
  if (pin > 7) return;
  if (on) pcf20Pending &= ~(1 << pin);
  else    pcf20Pending |=  (1 << pin);
  pcf20Dirty = true;
}

static inline void pcf20_flush() {
  if (!g_pcf20_ok) return;
  if (!pcf20Dirty) return;
  if (pcf20Pending == pcf20Out) { pcf20Dirty = false; return; }
  
  pcf20Out = pcf20Pending;
  
  I2C_LOCK();
  // OPTIMIZATION: Write single byte directly instead of 8 separate writes
  Wire.beginTransmission(PCF20_ADDR);
  Wire.write(pcf20Out);
  Wire.endTransmission();
  I2C_UNLOCK();
  
  pcf20Dirty = false;
}

static inline void injSet(uint8_t cyl, bool on){
  if (cyl==1) pcf20_shadowWrite(PIN_INJ1,on);
  else if (cyl==2) pcf20_shadowWrite(PIN_INJ2,on);
  else if (cyl==3) pcf20_shadowWrite(PIN_INJ3,on);
  else if (cyl==4) pcf20_shadowWrite(PIN_INJ4,on);
}
static inline void coilSet(uint8_t cyl, bool on){
  if (cyl==1) pcf20_shadowWrite(PIN_COIL1,on);
  else if (cyl==2) pcf20_shadowWrite(PIN_COIL2,on);
  else if (cyl==3) pcf20_shadowWrite(PIN_COIL3,on);
  else if (cyl==4) pcf20_shadowWrite(PIN_COIL4,on);
}
static inline void injAllOff(){ injSet(1,false); injSet(2,false); injSet(3,false); injSet(4,false); }
static inline void coilAllOff(){ coilSet(1,false); coilSet(2,false); coilSet(3,false); coilSet(4,false); }

// =====================================================
// START latch helper
// =====================================================
static inline void updateStaLatch() {
  if (g_staLatched) return;
  if (!g_pcf21_ok) return;

  I2C_LOCK();
  pcf21.write(STA_PCF_PIN, HIGH);
  bool staHigh = (pcf21.read(STA_PCF_PIN) == 0);
  I2C_UNLOCK();
  uint32_t nowMs = millis();

  if (staHigh) {
    if (g_staHighStartMs == 0) g_staHighStartMs = nowMs;
    if ((uint32_t)(nowMs - g_staHighStartMs) >= (uint32_t)STA_PULSE_MS) {
      g_staLatched = true;
    }
  } else {
    g_staHighStartMs = 0;
  }
}

// =====================================================
// CKP IN / CMP IN ISR
// =====================================================
void IRAM_ATTR isrCkpRise() {
  uint32_t now = (uint32_t)micros();
  g_lastCkpPulseUs = now;
  g_ckpPulseCount++;

  static uint32_t last = 0;
  static uint32_t avg = 0;
  if (last != 0) {
    uint32_t dt = now - last;
    if (avg == 0) avg = dt;
    avg = (avg * 7 + dt) / 8;
    if (avg > 0) {
      uint32_t rpm = 60000000UL / (avg * (uint32_t)CKP_SLOTS_TOTAL);
      if (rpm > 20000) rpm = 20000;
      g_rpmLive = (uint16_t)rpm;
    }
  }
  last = now;
}
void IRAM_ATTR isrCmpRise() { g_lastCmpPulseUs = (uint32_t)micros(); }

static inline bool cmpFallbackDetectBySampling(uint32_t windowUs = 3000, uint16_t minEdges = 4) {
  uint32_t t0 = (uint32_t)micros();
  int last = digitalRead(CMP_IN_PIN);
  uint16_t edges = 0;
  while ((uint32_t)((uint32_t)micros() - t0) < windowUs) {
    int v = digitalRead(CMP_IN_PIN);
    if (v != last) { edges++; last = v; }
  }
  if (edges >= minEdges) {
    g_lastCmpPulseUs = (uint32_t)micros();
    return true;
  }
  return false;
}

// =====================================================
// CKP GEN 33-3 timer ISR (ESP32 Core v3.3.7 API)
// =====================================================
hw_timer_t *ckpTimer = nullptr;
volatile bool ckpEnabled = true;
volatile uint32_t ckpToothUs = 1000;
volatile uint32_t ckpHighUs  = 200;
volatile uint8_t  ckpIdx = 0;
volatile bool     ckpHighPhase = false;

static inline bool isMissingTooth(uint8_t idx){ return (idx >= (CKP_SLOTS_TOTAL - CKP_MISSING)); }
static inline void updateCkpTiming(uint16_t rpm) {
  if (rpm < 300) rpm = 300;
  uint32_t tooth = (uint32_t)(60000000UL / ((uint32_t)rpm * (uint32_t)CKP_SLOTS_TOTAL));
  if (tooth < 250) tooth = 250;
  if (tooth > 5000) tooth = 5000;
  ckpToothUs = tooth;
  ckpHighUs  = tooth / 3;
  if (ckpHighUs < 50) ckpHighUs = 50;
  if (ckpHighUs >= ckpToothUs) ckpHighUs = ckpToothUs / 2;
}

void IRAM_ATTR onCkpTimer() {
  if (!ckpEnabled) {
    digitalWrite(CKP_GEN_PIN, LOW);
    ckpHighPhase = false;
    ckpIdx = 0;
    return;
  }

  if (!ckpHighPhase) {
    if (isMissingTooth(ckpIdx)) {
      digitalWrite(CKP_GEN_PIN, LOW);
      ckpIdx = (ckpIdx + 1) % CKP_SLOTS_TOTAL;
      timerAlarm(ckpTimer, ckpToothUs, true, 0);
    } else {
      digitalWrite(CKP_GEN_PIN, HIGH);
      ckpHighPhase = true;
      timerAlarm(ckpTimer, ckpHighUs, true, 0);
    }
  } else {
    digitalWrite(CKP_GEN_PIN, LOW);
    ckpHighPhase = false;
    uint32_t lowUs = ckpToothUs - ckpHighUs;
    if (lowUs < 50) lowUs = 50;
    ckpIdx = (ckpIdx + 1) % CKP_SLOTS_TOTAL;
    timerAlarm(ckpTimer, lowUs, true, 0);
  }
}

// =====================================================
// REV OUT timer ISR (ESP32 Core v3.3.7 API)
// =====================================================
hw_timer_t *revTimer = nullptr;
volatile bool revEnable = false;
volatile uint32_t revHalfUs = 5000;
volatile bool revState = false;

void IRAM_ATTR onRevTimer() {
  if (!revEnable) { digitalWrite(REV_OUT_PIN, LOW); return; }
  revState = !revState;
  digitalWrite(REV_OUT_PIN, revState ? HIGH : LOW);
}

static inline void revUpdate(uint16_t rpm) {
  if (rpm < 250) { revEnable = false; return; }
  float f = (rpm / 60.0f) * 2.0f; 
  if (f < 1.0f) f = 1.0f;
  float periodUs = 1000000.0f / f;
  uint32_t half = (uint32_t)(periodUs / 2.0f);
  if (half < 80) half = 80;
  revHalfUs = half;
  revEnable = true;
}

// =====================================================
// INJ/COIL ECU-like scheduling
// =====================================================
static const uint8_t FIRING_ORDER[4] = {1,3,4,2};
struct ChanState { bool injOn; bool coilOn; };
static ChanState st[4];
static uint32_t stepStartUs = 0;
static uint8_t  stepIndex = 0;
static uint32_t injOffUs[4]  = {0,0,0,0};
static uint32_t coilOffUs[4] = {0,0,0,0};

static inline float clampf(float v, float lo, float hi){
  if (v < lo) return lo; if (v > hi) return hi; return v;
}
static inline uint32_t clampOnByStep(uint32_t onUs, uint32_t stepUs, uint32_t minUs) {
  uint32_t maxUs = (uint32_t)((float)stepUs * VISUAL_MAX_ON_FRACTION);
  if (onUs > maxUs) onUs = maxUs;
  if (onUs < minUs) onUs = minUs;
  return onUs;
}

static void actuators_update(bool engineRunning,
                             uint16_t rpmUse,
                             bool mapOK, int16_t mapRaw,
                             bool tpsOK, int16_t tpsRaw,
                             bool ectOK, int16_t ectRaw,
                             bool iatOK, int16_t iatRaw,
                             bool o2OK,  int16_t o2Raw,
                             bool knkOK, int16_t knkRaw)
{
  pcf20Pending = pcf20Out;
  pcf20Dirty = false;

  if (!engineRunning || rpmUse < 200) {
    injAllOff(); coilAllOff();
    for (int i=0;i<4;i++){ st[i].injOn=false; st[i].coilOn=false; injOffUs[i]=0; coilOffUs[i]=0; }
    stepStartUs = 0;
    pcf20_flush();
    return;
  }

  uint32_t nowUs = micros();
  if (stepStartUs == 0) stepStartUs = nowUs;

  uint32_t stepUs = (uint32_t)(60000000UL / ((uint32_t)rpmUse * 2UL)); 
  stepUs = constrain(stepUs, 2000UL, 200000UL);

  for (int i=0;i<4;i++){
    if (st[i].injOn  && (int32_t)(nowUs - injOffUs[i])  >= 0) { injSet(i+1,false);  st[i].injOn=false; }
    if (st[i].coilOn && (int32_t)(nowUs - coilOffUs[i]) >= 0) { coilSet(i+1,false); st[i].coilOn=false; }
  }

  float map01 = mapOK ? clampf((float)mapRaw / 32767.0f, 0.0f, 1.0f) : 0.3f;
  float tps01 = tpsOK ? clampf((float)tpsRaw / 32767.0f, 0.0f, 1.0f) : 0.3f;
  float ect01 = ectOK ? clampf((float)ectRaw / 32767.0f, 0.0f, 1.0f) : 0.6f;
  float iat01 = iatOK ? clampf((float)iatRaw / 32767.0f, 0.0f, 1.0f) : 0.5f;
  float o2V   = o2OK  ? clampf((float)o2Raw  / 32767.0f, 0.0f, 1.0f) : 0.45f;
  float knk01 = knkOK ? clampf((float)knkRaw / 32767.0f, 0.0f, 1.0f) : 0.0f;

  float ectEnrich = 1.0f + (1.0f - ect01) * 0.6f;
  float iatCorr   = 1.0f - (iat01) * 0.2f;
  float o2Err     = (0.45f - o2V);
  float stft      = o2OK ? (1.0f + clampf(o2Err * 0.8f, -0.20f, +0.20f)) : 1.0f;

  float baseMs = 8.0f + 52.0f * (0.6f*tps01 + 0.4f*map01);
  float pwMs = baseMs * ectEnrich * iatCorr * stft;
  pwMs = clampf(pwMs, 1.0f, 120.0f);
  uint32_t pwUs = (uint32_t)(pwMs * 1000.0f);

  float dwellMs = 25.0f - 18.0f * knk01;
  dwellMs = clampf(dwellMs, 6.0f, 25.0f);
  uint32_t dwellUs = (uint32_t)(dwellMs * 1000.0f);

  pwUs    = clampOnByStep(pwUs,    stepUs, VISUAL_MIN_INJ_ON_US);
  dwellUs = clampOnByStep(dwellUs, stepUs, VISUAL_MIN_COIL_ON_US);

  int catchup = 0;
  while ((uint32_t)(nowUs - stepStartUs) >= stepUs && catchup < 6) {
    stepStartUs += stepUs;
    catchup++;

    stepIndex = (stepIndex + 1) & 0x03;
    uint8_t cyl = FIRING_ORDER[stepIndex];

    injSet(cyl, true);
    st[cyl-1].injOn = true;
    injOffUs[cyl-1] = nowUs + pwUs;

    coilSet(cyl, true);
    st[cyl-1].coilOn = true;
    coilOffUs[cyl-1] = nowUs + dwellUs;
  }

  pcf20_flush();
}

// =====================================================
// ISO-TP SEND (FIXED Flow Control)
// =====================================================
static void canSend8(uint16_t id, const uint8_t d[8]) {
  CAN0.sendMsgBuf(id, 0, 8, (uint8_t*)d);
}

static bool waitFlowControl(uint16_t expectedFcId, uint32_t timeoutMs = 120) {
  uint32_t t0 = millis();
  while (millis() - t0 < timeoutMs) {
    if (CAN_MSGAVAIL == CAN0.checkReceive()) {
      long unsigned int rxId;
      unsigned char len = 0;
      unsigned char buf[8];
      CAN0.readMsgBuf(&rxId, &len, buf);
      if ((uint16_t)rxId != expectedFcId) continue;
      if (len == 8 && ((buf[0] & 0xF0) == 0x30)) return true; 
    }
    vTaskDelay(1);
  }
  return false;
}

static void isotpSendPayload(uint16_t respId, const uint8_t *payload, uint16_t payloadLen) {
  g_txIsoTpActive = true; 
  
  if (payloadLen <= 7) {
    uint8_t sf[8] = {0};
    sf[0] = (uint8_t)(payloadLen & 0x0F);
    for (uint8_t i = 0; i < payloadLen; i++) sf[1 + i] = payload[i];
    canSend8(respId, sf);
    g_txIsoTpActive = false;
    return;
  }

  uint8_t ff[8] = {0};
  ff[0] = 0x10 | ((payloadLen >> 8) & 0x0F);
  ff[1] = (uint8_t)(payloadLen & 0xFF);
  uint16_t idx = 0;
  for (uint8_t i = 0; i < 6; i++) ff[2 + i] = (idx < payloadLen) ? payload[idx++] : 0;
  canSend8(respId, ff);

  // FIX: Cek hasil Flow Control
  if (!waitFlowControl(respId, 120)) {
      Serial.println("ISO-TP: FC Timeout");
      g_txIsoTpActive = false; 
      return;
  }

  uint8_t sn = 1;
  while (idx < payloadLen) {
    uint8_t cf[8] = {0};
    cf[0] = 0x20 | (sn & 0x0F);
    for (uint8_t i = 0; i < 7; i++) cf[1 + i] = (idx < payloadLen) ? payload[idx++] : 0;
    canSend8(respId, cf);
    sn = (sn + 1) & 0x0F;
    if (sn == 0) sn = 1;
    // FIX: Delay sedikit dikurangi agar lebih cepat (Standard STmin)
    vTaskDelay(pdMS_TO_TICKS(5)); 
  }
  g_txIsoTpActive = false; 
}

// =====================================================
// ISO-TP RX
// =====================================================
static uint8_t  rxIsoBuf[128];
static uint16_t rxIsoLen = 0;
static uint16_t rxIsoGot = 0;
static uint8_t  rxIsoNextSN = 1;
static bool     rxIsoActive = false;

static void isotpResetRx() {
  rxIsoLen = 0; rxIsoGot = 0; rxIsoNextSN = 1; rxIsoActive = false;
}

static bool isotpConsumeFrame(uint16_t rxId, const uint8_t *b, uint8_t len,
                              uint8_t *out, uint16_t outMax, uint16_t &outLen) {
  if (len != 8) return false;

  uint8_t pci = b[0];
  uint8_t type = (pci & 0xF0);

  if (type == 0x00) { 
    uint8_t L = (pci & 0x0F);
    if (L == 0 || L > 7) return false;
    if (L > outMax) return false;
    for (uint8_t i=0;i<L;i++) out[i] = b[1+i];
    outLen = L;
    isotpResetRx();
    return true;
  }

  if (type == 0x10) { 
    uint16_t L = ((uint16_t)(pci & 0x0F) << 8) | b[1];
    if (L == 0 || L > sizeof(rxIsoBuf) || L > outMax) { isotpResetRx(); return false; }
    rxIsoLen = L;
    rxIsoGot = 0;
    rxIsoNextSN = 1;
    rxIsoActive = true;

    for (uint8_t i=0;i<6;i++) rxIsoBuf[rxIsoGot++] = b[2+i];

    uint16_t respId = calcRespId(rxId);
    uint8_t fc[8] = {0x30, 0x00, 0x05, 0,0,0,0,0}; // STmin=5ms
    canSend8(respId, fc);
    return false;
  }

  if (type == 0x20) { 
    if (!rxIsoActive) return false;
    uint8_t sn = (pci & 0x0F);
    if (sn != rxIsoNextSN) { isotpResetRx(); return false; }
    rxIsoNextSN = (rxIsoNextSN + 1) & 0x0F;
    if (rxIsoNextSN == 0) rxIsoNextSN = 1;

    uint16_t remaining = (rxIsoLen > rxIsoGot) ? (rxIsoLen - rxIsoGot) : 0;
    uint8_t take = (remaining >= 7) ? 7 : (uint8_t)remaining;
    for (uint8_t i=0;i<take;i++) rxIsoBuf[rxIsoGot++] = b[1+i];

    if (rxIsoGot >= rxIsoLen) {
      for (uint16_t i=0;i<rxIsoLen;i++) out[i] = rxIsoBuf[i];
      outLen = rxIsoLen;
      isotpResetRx();
      return true;
    }
    return false;
  }

  return false;
}

// =====================================================
// OBD Handlers
// =====================================================
static inline void sendNRC_OBD(uint16_t respId, uint8_t svc, uint8_t nrc) {
  uint8_t p[3] = {0x7F, svc, nrc};
  isotpSendPayload(respId, p, 3);
}

static void reply0100(uint16_t respId) {
  uint32_t mask = 0;
  auto setPid = [&](uint8_t pid){
    if (pid < 1 || pid > 0x20) return;
    mask |= (1UL << (0x20 - pid));
  };
  setPid(0x01); setPid(0x0C);
  uint8_t p[6] = {0x41,0x00,(uint8_t)(mask>>24),(uint8_t)(mask>>16),(uint8_t)(mask>>8),(uint8_t)mask};
  isotpSendPayload(respId, p, 6);
}

static void reply0101(uint16_t respId) {
  uint8_t dtcCount = countUnionDtc();
  if (dtcCount > 127) dtcCount = 127;
  bool milOn = (dtcCount > 0);
  uint8_t A = (milOn ? 0x80 : 0x00) | (dtcCount & 0x7F);
  uint8_t p[6] = {0x41,0x01,A,0x07,0xE0,0x00};
  isotpSendPayload(respId, p, 6);
}

static void reply010C(uint16_t respId, uint16_t rpm) {
  uint16_t v = (uint16_t)rpm * 4;
  uint8_t p[4] = {0x41,0x0C,(uint8_t)(v>>8),(uint8_t)v};
  isotpSendPayload(respId, p, 4);
}

static uint16_t buildDtcPayload_WithCount(uint8_t respSvc,
                                         const volatile bool *arr,
                                         bool unionWithOther,
                                         uint8_t *out,
                                         uint16_t maxLen)
{
  uint8_t cnt = 0;
  for (uint8_t i=0;i<DTC_COUNT;i++){
    bool on = unionWithOther ? (dtcStored[i] || dtcCurrent[i]) : arr[i];
    if (on) cnt++;
  }

  uint16_t idx = 0;
  out[idx++] = respSvc;
  out[idx++] = cnt;

  for (uint8_t i=0;i<DTC_COUNT;i++){
    bool on = unionWithOther ? (dtcStored[i] || dtcCurrent[i]) : arr[i];
    if (!on) continue;
    if (idx + 2 > maxLen) break;
    out[idx++] = DTC_LIST[i].hi;
    out[idx++] = DTC_LIST[i].lo;
  }
  return idx;
}

static void replyMode03(uint16_t respId) {
  uint8_t payload[96];
  uint16_t n = buildDtcPayload_WithCount(0x43, dtcStored, true, payload, sizeof(payload));
  isotpSendPayload(respId, payload, n);
}
static void replyMode07(uint16_t respId) {
  uint8_t payload[96];
  uint16_t n = buildDtcPayload_WithCount(0x47, dtcCurrent, false, payload, sizeof(payload));
  isotpSendPayload(respId, payload, n);
}
static void replyMode0A(uint16_t respId) {
  uint8_t payload[96];
  uint16_t n = buildDtcPayload_WithCount(0x4A, dtcStored, false, payload, sizeof(payload));
  isotpSendPayload(respId, payload, n);
}
static void replyMode04(uint16_t respId) {
  for (uint8_t i=0;i<DTC_COUNT;i++){ dtcStored[i]=false; dtcCurrent[i]=false; }
  uint8_t p[1] = {0x44};
  isotpSendPayload(respId, p, 1);
}

// =====================================================
// UDS Handlers
// =====================================================
static const char VIN_STR[] = "HAKAJAYA000000000"; 

static void sendUDS_Negative(uint16_t respId, uint8_t sid, uint8_t nrc) {
  uint8_t payload[3] = {0x7F, sid, nrc};
  isotpSendPayload(respId, payload, 3);
}

static void handleUDS_ReadDataById(uint16_t respId, uint16_t did) {
  uint8_t out[64];
  uint16_t idx=0;
  out[idx++] = 0x62;
  out[idx++] = (did >> 8) & 0xFF;
  out[idx++] = (did >> 0) & 0xFF;

  uint16_t rpmLive, rpmTarget;
  int16_t mapRaw, tpsRaw, ectRaw, iatRaw;

  portENTER_CRITICAL(&mux);
  rpmLive = g_rpmLive; rpmTarget = g_rpmTarget;
  mapRaw = g_mapRaw; tpsRaw = g_tpsRaw; ectRaw = g_wtsRaw; iatRaw = g_iatRaw;
  portEXIT_CRITICAL(&mux);

  uint16_t rpmUse = (rpmLive > 0) ? rpmLive : rpmTarget;

  if (did == 0xF190) {
    for (uint8_t i=0;i<17;i++) out[idx++] = (uint8_t)VIN_STR[i];
  } else if (did == 0xF40C) {
    uint16_t raw = rpmUse * 4;
    out[idx++] = (raw >> 8) & 0xFF;
    out[idx++] = (raw >> 0) & 0xFF;
  } else if (did == 0xF405) {
    out[idx++] = (ectRaw >> 8) & 0xFF;
    out[idx++] = (ectRaw >> 0) & 0xFF;
  } else if (did == 0xF40B) {
    out[idx++] = (mapRaw >> 8) & 0xFF;
    out[idx++] = (mapRaw >> 0) & 0xFF;
  } else if (did == 0xF411) {
    out[idx++] = (tpsRaw >> 8) & 0xFF;
    out[idx++] = (tpsRaw >> 0) & 0xFF;
  } else if (did == 0xF40D) {
    out[idx++] = (iatRaw >> 8) & 0xFF;
    out[idx++] = (iatRaw >> 0) & 0xFF;
  } else {
    sendUDS_Negative(respId, 0x22, 0x31);
    return;
  }

  isotpSendPayload(respId, out, idx);
}

static inline void dtcToUDS3(uint8_t hi, uint8_t lo, uint8_t &b1, uint8_t &b2, uint8_t &b3) {
  b1 = hi; b2 = lo; b3 = 0x00;
}

static void handleUDS_ReadDTC(uint16_t respId, uint8_t subfn, uint8_t statusMask) {
  (void)statusMask;

  if (subfn == 0x01) {
    uint8_t cnt = countUnionDtc();
    uint8_t out[8] = {0};
    out[0] = 0x59; out[1] = 0x01; out[2] = 0xFF; out[3] = 0x01;
    out[4] = 0x00; out[5] = cnt;
    isotpSendPayload(respId, out, 6);
    return;
  }

  if (subfn == 0x02) {
    uint8_t out[96];
    uint16_t idx=0;
    out[idx++] = 0x59; out[idx++] = 0x02; out[idx++] = 0xFF; out[idx++] = 0x01;

    for (uint8_t i=0;i<DTC_COUNT;i++){
      if (!dtcCurrent[i] && !dtcStored[i]) continue;
      if (idx + 4 > sizeof(out)) break;

      uint8_t b1,b2,b3; dtcToUDS3(DTC_LIST[i].hi, DTC_LIST[i].lo, b1,b2,b3);
      out[idx++] = b1; out[idx++] = b2; out[idx++] = b3;

      uint8_t st = 0x00;
      if (dtcCurrent[i]) st |= 0x01;
      if (dtcStored[i])  st |= 0x08;
      out[idx++] = st;
    }
    isotpSendPayload(respId, out, idx);
    return;
  }

  sendUDS_Negative(respId, 0x19, 0x12);
}

static void handleUDS_ClearDTC(uint16_t respId) {
  for (uint8_t i=0;i<DTC_COUNT;i++){ dtcStored[i]=false; dtcCurrent[i]=false; }
  uint8_t ok[1] = {0x54};
  isotpSendPayload(respId, ok, 1);
}

// =====================================================
// DIAG dispatcher
// =====================================================
static void handleDiagPayload(uint16_t rxId, const uint8_t *p, uint16_t plen) {
  if (plen < 1) return;
  uint16_t respId = calcRespId(rxId);
  uint8_t sid = p[0];

  if (sid == 0x10 && plen >= 2) {
    uint8_t out[3] = { (uint8_t)0x50, p[1], 0x00 };
    isotpSendPayload(respId, out, 3);
    return;
  }
  if (sid == 0x3E) {
    uint8_t out[2] = { (uint8_t)0x7E, 0x00 };
    isotpSendPayload(respId, out, 2);
    return;
  }
  if (sid == 0x22 && plen >= 3) {
    uint16_t did = ((uint16_t)p[1] << 8) | p[2];
    handleUDS_ReadDataById(respId, did);
    return;
  }
  if (sid == 0x19 && plen >= 2) {
    uint8_t sub = p[1];
    uint8_t mask = (plen >= 3) ? p[2] : 0xFF;
    handleUDS_ReadDTC(respId, sub, mask);
    return;
  }
  if (sid == 0x14) {
    handleUDS_ClearDTC(respId);
    return;
  }

  if (sid == 0x01 && plen >= 2) {
    uint8_t pid = p[1];
    uint16_t rpmLive, rpmTarget;
    portENTER_CRITICAL(&mux);
    rpmLive = g_rpmLive; rpmTarget = g_rpmTarget;
    portEXIT_CRITICAL(&mux);
    uint16_t rpmUse = g_staLatched ? ((rpmLive > 0) ? rpmLive : rpmTarget) : 0;

    if (pid == 0x00) reply0100(respId);
    else if (pid == 0x01) reply0101(respId);
    else if (pid == 0x0C) reply010C(respId, rpmUse);
    else sendNRC_OBD(respId, 0x01, 0x12);
    return;
  }

  if (sid == 0x03) { replyMode03(respId); return; }
  if (sid == 0x07) { replyMode07(respId); return; }
  if (sid == 0x0A) { replyMode0A(respId); return; }
  if (sid == 0x04) { replyMode04(respId); return; }

  sendNRC_OBD(respId, sid, 0x11);
}

static void handleCanRx(uint16_t rxId, const uint8_t *buf, uint8_t len) {
  bool isFunctional = (rxId == REQ_FUNC_ID);
  bool isPhysical   = (rxId >= REQ_PHYS_MIN && rxId <= REQ_PHYS_MAX);
  if (!isFunctional && !isPhysical) return;

  uint8_t payload[128];
  uint16_t plen = 0;
  if (isotpConsumeFrame(rxId, buf, len, payload, sizeof(payload), plen)) {
    handleDiagPayload(rxId, payload, plen);
  }
}

static void canPoll() {
  if (CAN0.checkReceive() != CAN_MSGAVAIL) return;
  unsigned long rxId = 0;
  uint8_t len = 0;
  uint8_t buf[8] = {0};
  CAN0.readMsgBuf(&rxId, &len, buf);
  if (len > 8) len = 8;
  handleCanRx((uint16_t)rxId, buf, len);
}

// =====================================================
// STATUS & CMD
// =====================================================
static void printDtcList(const char* title, const volatile bool *arr) {
  Serial.print(title); Serial.print(" count=");
  uint8_t c = countActive(arr);
  Serial.println(c);
  if (c == 0) { Serial.println("  (none)"); return; }
  for (uint8_t i=0;i<DTC_COUNT;i++){
    if (!arr[i]) continue;
    Serial.print("  - "); Serial.print(DTC_LIST[i].label);
    Serial.print("  ["); Serial.print(DTC_LIST[i].hi, HEX);
    Serial.print(" ");    Serial.print(DTC_LIST[i].lo, HEX);
    Serial.println("]");
  }
}

static void printHelp() {
  Serial.println("CMD: status | dtc | clear | zero | map+/- | tps+/- | wts+/- | iat+/- | o2+/- | knk+/- | vvti+/- | isc+/- | rpm+/-");
}

static void printStatus() {
  uint16_t rpmLive, rpmTarget;
  int16_t mapRaw, tpsRaw, ectRaw, iatRaw, o2Raw, knkRaw, potRaw;
  uint32_t pulses, lastCkp, lastCmp;
  int32_t of_rpm, of_vvti, of_isc;

  portENTER_CRITICAL(&mux);
  rpmLive = g_rpmLive; rpmTarget = g_rpmTarget;
  mapRaw = g_mapRaw; tpsRaw = g_tpsRaw; ectRaw = g_wtsRaw; iatRaw = g_iatRaw;
  o2Raw = g_o2Raw; knkRaw = g_knkRaw; potRaw = g_potRaw;
  pulses = g_ckpPulseCount; lastCkp = g_lastCkpPulseUs; lastCmp = g_lastCmpPulseUs;
  of_rpm = off_rpm; of_vvti = off_vvti_pct; of_isc = off_isc_pct;
  portEXIT_CRITICAL(&mux);

  uint32_t nowUs = micros();
  bool ckpPresent = (lastCkp != 0 && (nowUs - lastCkp) <= 300000UL);
  bool cmpPresent = (lastCmp != 0 && (nowUs - lastCmp) <= 600000UL);
  if (!cmpPresent && ckpPresent) cmpPresent = cmpFallbackDetectBySampling(3000, 4);
  bool vvtiPresent = (digitalRead(VVTI_SENSE_PIN) == HIGH);

  updateStaLatch();
  bool engineRunning = g_staLatched && ckpPresent && (rpmTarget >= 650);
  bool milOn  = (countUnionDtc() > 0);
  
  uint32_t nowMs = millis();
  bool fuelOn = engineRunning;
  if (fuelPrimeActive) {
    if ((uint32_t)(nowMs - fuelPrimeStartMs) < FUEL_PRIME_MS) fuelOn = true;
    else fuelPrimeActive = false;
  }

  bool ectOK = g_ads48_ok && sensorPresent_ECT(ectRaw);
  bool fanOn = (!ectOK) ? true : (ectRaw > 24000);

  Serial.println("=== STATUS ===");
  Serial.print("STA="); Serial.print(g_staLatched?1:0);
  Serial.print(" ENG="); Serial.print(engineRunning?1:0);
  Serial.print(" CKP="); Serial.print(ckpPresent?1:0);
  Serial.print(" RPM_Live="); Serial.print(rpmLive);
  Serial.print(" RPM_Tgt="); Serial.println(rpmTarget);

  Serial.print("LAMPS: MIL="); Serial.print(milOn?1:0);
  Serial.print(" FUEL="); Serial.print(fuelOn?1:0);
  Serial.print(" FAN="); Serial.println(fanOn?1:0);

  Serial.print("SENSORS(V): MAP="); Serial.print(adsRawToVolt(mapRaw),3);
  Serial.print(" TPS="); Serial.print(adsRawToVolt(tpsRaw),3);
  Serial.print(" ECT="); Serial.print(adsRawToVolt(ectRaw),3);
  Serial.print(" IAT="); Serial.print(adsRawToVolt(iatRaw),3);
  Serial.print(" O2="); Serial.print(adsRawToVolt(o2Raw),3);
  Serial.print(" KNK="); Serial.print(adsRawToVolt(knkRaw),3);
  Serial.print(" POT="); Serial.println(adsRawToVolt(potRaw),3);

  uint8_t p20;
  portENTER_CRITICAL(&mux); p20 = pcf20Out; portEXIT_CRITICAL(&mux);
  int inj1 = (p20 & (1 << PIN_INJ1)) ? 0 : 1;
  int inj2 = (p20 & (1 << PIN_INJ2)) ? 0 : 1;
  int inj3 = (p20 & (1 << PIN_INJ3)) ? 0 : 1;
  int inj4 = (p20 & (1 << PIN_INJ4)) ? 0 : 1;
  int c1 = (p20 & (1 << PIN_COIL1)) ? 0 : 1;
  int c2 = (p20 & (1 << PIN_COIL2)) ? 0 : 1;
  int c3 = (p20 & (1 << PIN_COIL3)) ? 0 : 1;
  int c4 = (p20 & (1 << PIN_COIL4)) ? 0 : 1;

  Serial.print("VB_IO: INJ="); Serial.print(inj1); Serial.print(","); Serial.print(inj2); Serial.print(","); Serial.print(inj3); Serial.print(","); Serial.println(inj4);
  Serial.print("       COIL="); Serial.print(c1); Serial.print(","); Serial.print(c2); Serial.print(","); Serial.print(c3); Serial.print(","); Serial.println(c4);

  Serial.print("OFFSETS: rpm="); Serial.print(of_rpm);
  Serial.print(" vvti="); Serial.print(of_vvti); Serial.print("%");
  Serial.print(" isc="); Serial.print(of_isc); Serial.println("%");
  
  printDtcList("DTC STORED", dtcStored);
  printDtcList("DTC CURRENT", dtcCurrent);
}

static inline bool okSensorMap()  { return !dtcCurrent[IDX_MAP]  && !dtcStored[IDX_MAP]; }
static inline bool okSensorTps()  { return !dtcCurrent[IDX_TPS]  && !dtcStored[IDX_TPS]; }
static inline bool okSensorWts()  { return !dtcCurrent[IDX_WTS]  && !dtcStored[IDX_WTS]; }
static inline bool okSensorIat()  { return !dtcCurrent[IDX_IAT]  && !dtcStored[IDX_IAT]; }
static inline bool okSensorO2()   { return !dtcCurrent[IDX_O2]   && !dtcStored[IDX_O2]; }
static inline bool okSensorKnk()  { return !dtcCurrent[IDX_KNK]  && !dtcStored[IDX_KNK]; }
static inline bool okCkp()        { return !dtcCurrent[IDX_CKP]  && !dtcStored[IDX_CKP]; }
static inline bool okVvti()       { return !dtcCurrent[IDX_VVTI] && !dtcStored[IDX_VVTI]; }
static inline bool okIsc()        { return !dtcCurrent[IDX_ISC]  && !dtcStored[IDX_ISC]; }

static inline void setForce(uint8_t idx, bool on) {
  if (idx >= DTC_COUNT) return;
  g_forceDtc[idx] = on;
}

static bool parseForceCmd(const String &cmd) {
  if (cmd.length() < 4) return false;
  char last = cmd.charAt(cmd.length()-1);
  if (last != '0' && last != '1') return false;
  bool on = (last == '0'); 
  String k = cmd.substring(0, cmd.length()-1);

  if (k == "map")  { setForce(IDX_MAP,  on); Serial.printf("OK: MAP force=%d\n", on); return true; }
  if (k == "tps")  { setForce(IDX_TPS,  on); Serial.printf("OK: TPS force=%d\n", on); return true; }
  if (k == "wts" || k=="ect")  { setForce(IDX_WTS,  on); Serial.printf("OK: WTS force=%d\n", on); return true; }
  if (k == "iat")  { setForce(IDX_IAT,  on); Serial.printf("OK: IAT force=%d\n", on); return true; }
  if (k == "o2")   { setForce(IDX_O2,   on); Serial.printf("OK: O2 force=%d\n", on); return true; }
  if (k == "knk" || k=="knock") { setForce(IDX_KNK,  on); Serial.printf("OK: KNK force=%d\n", on); return true; }
  if (k == "ckp")  { setForce(IDX_CKP,  on); Serial.printf("OK: CKP force=%d\n", on); return true; }
  if (k == "cmp")  { setForce(IDX_CMP,  on); Serial.printf("OK: CMP force=%d\n", on); return true; }
  if (k == "vvti") { setForce(IDX_VVTI, on); Serial.printf("OK: VVTI force=%d\n", on); return true; }
  if (k == "isc" || k=="iac")  { setForce(IDX_ISC,  on); Serial.printf("OK: ISC force=%d\n", on); return true; }
  return false;
}

static void resetAllToNormal() {
  for (uint8_t i=0;i<DTC_COUNT;i++) g_forceDtc[i] = false;
  for (uint8_t i=0;i<DTC_COUNT;i++){ dtcStored[i]=false; dtcCurrent[i]=false; }
  
  portENTER_CRITICAL(&mux);
  off_map_kpa=0; off_tps_pct=0; off_wts_c=0; off_iat_c=0;
  off_o2_mV=0; off_knk_mV=0; off_rpm=0; off_vvti_pct=0; off_isc_pct=0;
  portEXIT_CRITICAL(&mux);

  g_staLatched = false; g_staHighStartMs = 0;
  fuelPrimeStartMs = 0; fuelPrimeActive = false;
  Serial.println("OK: resetall");
}

static String g_serLine;
static void processCommand(String cmd) {
  cmd.trim(); cmd.toLowerCase();
  if (cmd.length() == 0) return;

  if (cmd == "resetall" || cmd == "reset") { resetAllToNormal(); return; }
  if (parseForceCmd(cmd)) { return; }
  if (cmd == "help" || cmd == "?") { printHelp(); return; }
  if (cmd == "status") { printStatus(); return; }
  if (cmd == "dtc") { printDtcList("DTC STORED", dtcStored); printDtcList("DTC CURRENT", dtcCurrent); return; }
  if (cmd == "clear" || cmd == "clr") {
    for (uint8_t i=0;i<DTC_COUNT;i++) dtcStored[i] = false;
    Serial.println("OK: DTC STORED cleared.");
    return;
  }
  if (cmd == "zero") {
    portENTER_CRITICAL(&mux);
    off_map_kpa=0; off_tps_pct=0; off_wts_c=0; off_iat_c=0;
    off_o2_mV=0; off_knk_mV=0; off_rpm=0; off_vvti_pct=0; off_isc_pct=0;
    portEXIT_CRITICAL(&mux);
    g_staLatched = false; g_staHighStartMs = 0;
    Serial.println("OK: offsets zeroed + STA reset");
    return;
  }

  auto ignored = [&](const char* name){
    Serial.print("IGNORED: "); Serial.print(name);
    Serial.println(" sensor fault active.");
  };

  if (cmd == "map+") {
    if (!okSensorMap()) { ignored("MAP"); return; }
    portENTER_CRITICAL(&mux); off_map_kpa += 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "map-") {
    if (!okSensorMap()) { ignored("MAP"); return; }
    portENTER_CRITICAL(&mux); off_map_kpa -= 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "tps+") {
    if (!okSensorTps()) { ignored("TPS"); return; }
    portENTER_CRITICAL(&mux); off_tps_pct += 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "tps-") {
    if (!okSensorTps()) { ignored("TPS"); return; }
    portENTER_CRITICAL(&mux); off_tps_pct -= 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "wts+") {
    if (!okSensorWts()) { ignored("WTS"); return; }
    portENTER_CRITICAL(&mux); off_wts_c += 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "wts-") {
    if (!okSensorWts()) { ignored("WTS"); return; }
    portENTER_CRITICAL(&mux); off_wts_c -= 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "iat+") {
    if (!okSensorIat()) { ignored("IAT"); return; }
    portENTER_CRITICAL(&mux); off_iat_c += 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "iat-") {
    if (!okSensorIat()) { ignored("IAT"); return; }
    portENTER_CRITICAL(&mux); off_iat_c -= 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "o2+") {
    if (!okSensorO2()) { ignored("O2"); return; }
    portENTER_CRITICAL(&mux); off_o2_mV += 50; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "o2-") {
    if (!okSensorO2()) { ignored("O2"); return; }
    portENTER_CRITICAL(&mux); off_o2_mV -= 50; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "knk+") {
    if (!okSensorKnk()) { ignored("KNK"); return; }
    portENTER_CRITICAL(&mux); off_knk_mV += 50; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "knk-") {
    if (!okSensorKnk()) { ignored("KNK"); return; }
    portENTER_CRITICAL(&mux); off_knk_mV -= 50; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "rpm+") {
    if (!okCkp()) { ignored("CKP"); return; }
    portENTER_CRITICAL(&mux); off_rpm += 100; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "rpm-") {
    if (!okCkp()) { ignored("CKP"); return; }
    portENTER_CRITICAL(&mux); off_rpm -= 100; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "vvti+") {
    if (!okVvti()) { ignored("VVTI"); return; }
    portENTER_CRITICAL(&mux); off_vvti_pct += 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "vvti-") {
    if (!okVvti()) { ignored("VVTI"); return; }
    portENTER_CRITICAL(&mux); off_vvti_pct -= 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "isc+") {
    if (!okIsc()) { ignored("ISC"); return; }
    portENTER_CRITICAL(&mux); off_isc_pct += 5; portEXIT_CRITICAL(&mux);
  }
  else if (cmd == "isc-") {
    if (!okIsc()) { ignored("ISC"); return; }
    portENTER_CRITICAL(&mux); off_isc_pct -= 5; portEXIT_CRITICAL(&mux);
  }
  else {
    Serial.print("UNKNOWN CMD: "); Serial.println(cmd);
  }
  Serial.println("OK");
}

static void serialPoll() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      processCommand(g_serLine);
      g_serLine = "";
    } else {
      if (g_serLine.length() < 64) g_serLine += c;
    }
  }
}

// =====================================================
// Main Loop Functions
// =====================================================
static void fastTick() {
  uint16_t rpmTarget, rpmLive;
  int16_t mapRaw,tpsRaw,ectRaw,iatRaw,o2Raw,knkRaw,potRaw;
  uint32_t lastCkpUs;
  int32_t of_rpm_local, of_vvti_local, of_isc_local;

  portENTER_CRITICAL(&mux);
  rpmTarget = g_rpmTarget; rpmLive = g_rpmLive;
  mapRaw=g_mapRaw; tpsRaw=g_tpsRaw; ectRaw=g_wtsRaw; iatRaw=g_iatRaw;
  o2Raw=g_o2Raw; knkRaw=g_knkRaw; potRaw=g_potRaw;
  lastCkpUs = g_lastCkpPulseUs;
  of_rpm_local = off_rpm; of_vvti_local= off_vvti_pct; of_isc_local = off_isc_pct;
  portEXIT_CRITICAL(&mux);

  uint32_t nowUs = micros();
  bool ckpPresent = (lastCkpUs != 0 && (nowUs - lastCkpUs) <= 300000UL);

  updateStaLatch();
  bool engineRunning = g_staLatched && ckpPresent && (rpmTarget >= 650);
  uint16_t rpmUse = g_staLatched ? ((rpmLive > 0) ? rpmLive : rpmTarget) : 0;

  updateCkpTiming((rpmTarget < 300) ? 300 : rpmTarget);
  ckpEnabled = g_staLatched;
  
  ledcWrite(L298_ENA_PWM, g_staLatched ? pwmFromPot(potRaw) : 0);

  bool vvtiPresent = (digitalRead(VVTI_SENSE_PIN) == HIGH);
  int32_t vvtiDutyPct = 0;
  if (vvtiPresent && engineRunning && rpmUse > 2500) {
    long d = map((long)rpmUse, 2500, 6000, 30, 80);
    if (d < 0) d = 0; if (d > 100) d = 100;
    vvtiDutyPct = d;
  }
  vvtiDutyPct += of_vvti_local;
  vvtiDutyPct = clampI32(vvtiDutyPct, 0, 95);
  ledcWrite(VVTI_PWM_PIN, (uint8_t)(vvtiDutyPct * 255 / 100));

  revUpdate(engineRunning ? rpmUse : 0);
  if (revTimer) timerAlarm(revTimer, revHalfUs, true, 0);

  bool mapOK = g_ads48_ok && sensorPresent_Generic(mapRaw);
  bool tpsOK = g_ads48_ok && sensorPresent_Generic(tpsRaw);
  bool ectOK = g_ads48_ok && sensorPresent_ECT(ectRaw);
  bool iatOK = g_ads48_ok && sensorPresent_Generic(iatRaw);
  bool o2OK  = g_ads49_ok && sensorPresent_Generic(o2Raw);
  bool knkOK = g_ads49_ok && sensorPresent_Generic(knkRaw);

  actuators_update(engineRunning, rpmUse,
      mapOK,mapRaw, tpsOK,tpsRaw, ectOK,ectRaw, iatOK,iatRaw, o2OK,o2Raw, knkOK,knkRaw);
}

static void ioTick() {
  static uint32_t lastPrint = 0;
  static uint8_t iscStep = 0;
  static uint32_t lastIscMs = 0;

  updateStaLatch();

  bool a48 = g_ads48_ok;
  bool a49 = g_ads49_ok;
  int16_t mapRaw=0, tpsRaw=0, ectRaw=0, iatRaw=0;
  int16_t o2Raw=0,  knkRaw=0, potRaw=0;

  if (a48) {
    mapRaw = adsReadCh(ads48,0);
    tpsRaw = adsReadCh(ads48,1);
    ectRaw = adsReadCh(ads48,2);
    iatRaw = adsReadCh(ads48,3);
  }
  if (a49) {
    o2Raw  = adsReadCh(ads49,0);
    knkRaw = adsReadCh(ads49,1);
    potRaw = adsReadCh(ads49,2);
  }

  bool mapHW_OK = a48 && sensorPresent_Generic(mapRaw);
  bool tpsHW_OK = a48 && sensorPresent_Generic(tpsRaw);
  bool ectHW_OK = a48 && sensorPresent_ECT(ectRaw);
  bool iatHW_OK = a48 && sensorPresent_Generic(iatRaw);
  bool o2HW_OK  = a49 && sensorPresent_Generic(o2Raw);
  bool knkHW_OK = a49 && sensorPresent_Generic(knkRaw);

  int32_t of_map, of_tps, of_wts, of_iat, of_o2, of_knk, of_rpm_local, of_isc_local;
  portENTER_CRITICAL(&mux);
  of_map = off_map_kpa; of_tps = off_tps_pct; of_wts = off_wts_c; of_iat = off_iat_c;
  of_o2  = off_o2_mV;  of_knk = off_knk_mV;
  of_rpm_local = off_rpm; of_isc_local = off_isc_pct;
  portEXIT_CRITICAL(&mux);

  int16_t mapSim = mapRaw, tpsSim = tpsRaw, ectSim = ectRaw, iatSim = iatRaw, o2Sim = o2Raw, knkSim = knkRaw;

  if (a48) {
    float v = adsRawToVolt(mapSim);
    float kpa = v_to_map_kpa(v) + (float)of_map;
    if (kpa < 0) kpa = 0; if (kpa > 300) kpa = 300;
    mapSim = voltToAdsRaw(map_kpa_to_v(kpa));

    v = adsRawToVolt(tpsSim);
    float pct = v_to_pct(v) + (float)of_tps;
    if (pct < 0) pct = 0; if (pct > 100) pct = 100;
    tpsSim = voltToAdsRaw(pct_to_v(pct));

    v = adsRawToVolt(ectSim);
    float ectC = v_to_ect_c(v) + (float)of_wts;
    if (ectC < -40) ectC = -40; if (ectC > 140) ectC = 140;
    ectSim = voltToAdsRaw(ect_c_to_v(ectC < 0 ? 0 : ectC));

    v = adsRawToVolt(iatSim);
    float iatC = v_to_iat_c(v) + (float)of_iat;
    if (iatC < -40) iatC = -40; if (iatC > 140) iatC = 140;
    iatSim = voltToAdsRaw(iat_c_to_v(iatC < 0 ? 0 : iatC));
  }
  if (a49) {
    float v = adsRawToVolt(o2Sim) + ((float)of_o2 / 1000.0f);
    if (v < 0) v = 0; if (v > 1.0f) v = 1.0f;
    o2Sim = voltToAdsRaw(v);

    v = adsRawToVolt(knkSim) + ((float)of_knk / 1000.0f);
    if (v < 0) v = 0; if (v > 4.096f) v = 4.096f;
    knkSim = voltToAdsRaw(v);
  }

  portENTER_CRITICAL(&mux);
  g_mapRaw = mapSim; g_tpsRaw = tpsSim; g_wtsRaw = ectSim; g_iatRaw = iatSim;
  g_o2Raw  = o2Sim;  g_knkRaw = knkSim; g_potRaw = potRaw;
  
  uint16_t rpmT = g_staLatched ? rpmFromPot(potRaw) : 0;
  long rpmAdj = (long)rpmT + of_rpm_local;
  g_rpmTarget = clampU16(rpmAdj, RPM_MIN, RPM_MAX);
  portEXIT_CRITICAL(&mux);

  uint32_t nowUs = micros();
  bool ckpPresent = (g_lastCkpPulseUs != 0 && (nowUs - g_lastCkpPulseUs) <= 300000UL);
  bool cmpPresent = (g_lastCmpPulseUs != 0 && (nowUs - g_lastCmpPulseUs) <= 600000UL);
  if (!cmpPresent && ckpPresent) cmpPresent = cmpFallbackDetectBySampling(3000, 4);
  bool vvtiPresent = (digitalRead(VVTI_SENSE_PIN) == HIGH);

  dtcCurrent[IDX_MAP]  = g_forceDtc[IDX_MAP]  || !mapHW_OK;
  dtcCurrent[IDX_TPS]  = g_forceDtc[IDX_TPS]  || !tpsHW_OK;
  dtcCurrent[IDX_WTS]  = g_forceDtc[IDX_WTS]  || !ectHW_OK;
  dtcCurrent[IDX_IAT]  = g_forceDtc[IDX_IAT]  || !iatHW_OK;
  dtcCurrent[IDX_O2 ]  = g_forceDtc[IDX_O2 ]  || !o2HW_OK;
  dtcCurrent[IDX_KNK]  = g_forceDtc[IDX_KNK]  || !knkHW_OK;
  dtcCurrent[IDX_CKP]  = g_forceDtc[IDX_CKP]  || !ckpPresent;
  dtcCurrent[IDX_CMP]  = g_forceDtc[IDX_CMP]  || !cmpPresent;
  dtcCurrent[IDX_VVTI] = g_forceDtc[IDX_VVTI] || !vvtiPresent;
  dtcCurrent[IDX_ISC]  = g_forceDtc[IDX_ISC]  || !g_pcf21_ok;

  static uint32_t holdoffMs = 0;
  if (holdoffMs == 0) holdoffMs = millis() + 2000;
  if ((int32_t)(millis() - holdoffMs) >= 0) {
    for (uint8_t i=0;i<DTC_COUNT;i++) if (dtcCurrent[i]) dtcStored[i] = true;
  }

  bool engineRunning = g_staLatched && ckpPresent && (g_rpmTarget >= 650);
  bool milOn  = (countUnionDtc() > 0);

  uint32_t nowMs = millis();
  if (g_staLatched && !lastStaLatched) { fuelPrimeActive = true; fuelPrimeStartMs = nowMs; }
  lastStaLatched = g_staLatched;

  bool fuelOn = engineRunning;
  if (fuelPrimeActive) {
    if ((uint32_t)(nowMs - fuelPrimeStartMs) < FUEL_PRIME_MS) fuelOn = true;
    else fuelPrimeActive = false;
  }

  bool fanOn  = (!ectHW_OK) ? true : (ectSim > 24000);

  pcf21_write(PIN_MIL,  milOn);
  pcf21_write(PIN_FUEL, fuelOn);
  pcf21_write(PIN_FAN,  fanOn);

  uint32_t baseIscMs = engineRunning ? 60 : 200;
  long adj = (long)baseIscMs - (of_isc_local * 2);
  if (adj < 20) adj = 20; if (adj > 500) adj = 500;

  if (nowMs - lastIscMs >= (uint32_t)adj) {
    lastIscMs = nowMs;
    pcf21_write(PIN_ISC_A, iscStep == 0);
    pcf21_write(PIN_ISC_B, iscStep == 1);
    pcf21_write(PIN_ISC_C, iscStep == 2);
    pcf21_write(PIN_ISC_D, iscStep == 3);
    iscStep = (iscStep + 1) & 0x03;
  }

  if (!g_txIsoTpActive) {
     if (CAN_MSGAVAIL == CAN0.checkReceive()) {
        long unsigned int rxId; unsigned char len = 0; unsigned char buf[8];
        CAN0.readMsgBuf(&rxId, &len, buf);
        handleCanRx((uint16_t)rxId, buf, (uint8_t)len);
     }
  }

  if (nowMs - lastPrint >= 500) {
    lastPrint = nowMs;
    printStatus();
  }
}

// =====================================================
// Setup (ESP32 Core v3.3.7 API)
// =====================================================
void setup() {
  Serial.begin(115200);
  delay(200);

  portENTER_CRITICAL(&mux);
  off_map_kpa=0; off_tps_pct=0; off_wts_c=0; off_iat_c=0;
  off_o2_mV=0; off_knk_mV=0; off_rpm=0; off_vvti_pct=0; off_isc_pct=0;
  portEXIT_CRITICAL(&mux);

  // FIX: Initialize I2C Mutex
  g_i2cMutex = xSemaphoreCreateMutex();
  if (g_i2cMutex == nullptr) {
    Serial.println("FATAL: Failed to create I2C Mutex");
    while(1);
  }

  for (uint8_t i=0;i<DTC_COUNT;i++){ dtcCurrent[i]=true; dtcStored[i]=false; }
  for (uint8_t i=0;i<DTC_COUNT;i++){ g_forceDtc[i]=false; }

  fuelPrimeActive = true; fuelPrimeStartMs = millis(); lastStaLatched = false;
  pinMode(VVTI_SENSE_PIN, INPUT_PULLUP);
  
  Wire.begin(21, 22);
  Wire.setClock(400000); // FIX: Set I2C to Fast Mode

  g_ads48_ok = ads48.begin(ADS48_ADDR);
  g_ads49_ok = ads49.begin(ADS49_ADDR);
  if (g_ads48_ok) ads48.setGain(GAIN_ONE);
  if (g_ads49_ok) ads49.setGain(GAIN_ONE);

  g_pcf20_ok = true; g_pcf21_ok = true;
  I2C_LOCK();
  pcf20.begin(); pcf21.begin();
  I2C_UNLOCK();
  
  pcf20Out = 0xFF; pcf20Pending = pcf20Out; pcf20Dirty = true; pcf20_flush();
  for (uint8_t i=0;i<8;i++) pcf21.write(i, LOW);
  pcf21.write(STA_PCF_PIN, HIGH); 

  pinMode(CKP_IN_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(CKP_IN_PIN), isrCkpRise, RISING);
  pinMode(CMP_IN_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(CMP_IN_PIN), isrCmpRise, RISING);

  pinMode(CKP_GEN_PIN, OUTPUT); digitalWrite(CKP_GEN_PIN, LOW);
  ckpTimer = timerBegin(1000000); 
  timerAttachInterrupt(ckpTimer, &onCkpTimer);
  timerAlarm(ckpTimer, 1000, true, 0);

  pinMode(REV_OUT_PIN, OUTPUT); digitalWrite(REV_OUT_PIN, LOW);
  revTimer = timerBegin(1000000);
  timerAttachInterrupt(revTimer, &onRevTimer);
  timerAlarm(revTimer, 5000, true, 0);
  revEnable = false;

  ledcAttach(VVTI_PWM_PIN, 200, 8);
  ledcWrite(VVTI_PWM_PIN, 0);
  ledcAttach(L298_ENA_PWM, 5000, 8);
  ledcWrite(L298_ENA_PWM, 0);

  pinMode(CAN_INT, INPUT_PULLUP);
  SPI.begin(18, 19, 23, CAN_CS);
  if (CAN0.begin(MCP_ANY, CAN_SPEED, CAN_CLOCK) == CAN_OK) {
    Serial.println("MCP2515 Init OK");
  } else {
    Serial.println("MCP2515 Init FAIL");
    while(1);
  }
  CAN0.setMode(MCP_NORMAL);

  Serial.println("=== ECU TRAINER V2 FIXED ===");
}

void loop() {
  static uint32_t lastFastUs = 0;
  static uint32_t lastIoMs   = 0;

  serialPoll();
  
  uint32_t nowUs = (uint32_t)micros();
  if ((uint32_t)(nowUs - lastFastUs) >= 1000) {
    lastFastUs = nowUs;
    fastTick();
  }

  uint32_t nowMs = (uint32_t)millis();
  if ((uint32_t)(nowMs - lastIoMs) >= 5) {
    lastIoMs = nowMs;
    ioTick();
  }
  delay(1);
}