/* ====================================================================================================================
   EPS CAN TRAINER SYSTEM - BULLETPROOF EDITION
   Target: ESP32 WROOM (Dual Core)
   Display: ILI9341 (Parallel 8-bit via LovyanGFX)
   CAN: MCP2515 (SPI)
   I/O: PCF8574 (I2C)
   
   HISTORY OF FIXES (Anti-Restart):
   1. I2C Race Condition -> Ditambahkan i2cMutex (Wire.h tidak thread-safe di ESP32)
   2. Mutex Deadlock -> Menghapus portMAX_DELAY, diganti timeout pdMS_TO_TICKS(10)
   3. Stack Overflow UI -> UI dipindah ke Task1 dengan Stack 16384 byte
   4. Watchdog (WDT) Reset -> UI dibatasi 30FPS (vTaskDelay 33ms), CAN task diberi delay
   5. Guru Meditation -> loop() dikosongkan, semua logic ada di FreeRTOS Task
   ==================================================================================================================== */

#include <SPI.h>
#include <mcp_can.h>
#include <Wire.h>
#include <LovyanGFX.hpp>
#include <math.h>

/* ====================================================================================================================
   1. PIN CONFIGURATION
   ==================================================================================================================== */
#define CAN_CS   15
#define CAN_INT  35  // Pin Interrupt (Input Only)

// Pin SPI khusus untuk MCP2515
#define SPI_MOSI 23
#define SPI_MISO 19
#define SPI_SCK  18

// Pin Potentiometer (Simulasi Gas/Kecepatan)
#define POT_PIN  34

// Alamat I2C untuk PCF8574
#define KEYPAD_ADDR 0x20   
#define IO_EXP_ADDR 0x21   

// Bit Mapping pada PCF8574 #2 (IO_EXP_ADDR)
#define LED_BIT   0  // Bit 0 untuk LED (Active Low)
#define START_BIT 1  // Bit 1 untuk Tombol Start

/* ====================================================================================================================
   2. PROTOCOL DEFINITIONS (UDS Simulation)
   ==================================================================================================================== */
#define CAN_SPEED CAN_500KBPS
#define CAN_CLOCK MCP_8MHZ

// CAN IDs
#define EPS_REQUEST_ID    0x7A1
#define EPS_RESPONSE_ID   0x7A9
#define BROADCAST_ID      0x1C0

// UDS Service IDs
#define UDS_REQUEST       0x21
#define UDS_RESPONSE      0x61
#define UDS_NEGATIVE      0x7F

// Parameter IDs (PIDs)
#define PID_TORQUE        0x01
#define PID_SPEED         0x03
#define PID_RPM           0x06
#define PID_BATTERY       0x0C

// Konstanta Data
#define EPS_STATUS_BYTE   0xE4
#define VOLTAGE_DIVIDER   205.0

// Timing Constants (dalam milidetik)
#define DEBOUNCE_TIME     50
#define EPS_TIMEOUT       1000
#define REQUEST_INTERVAL  500
#define UI_FPS_DELAY      33  // ~30 FPS agar CPU tidak 100% dan WDT aman

/* ====================================================================================================================
   3. LOVYANGFX DISPLAY CONFIGURATION (PARALLEL 8-BIT)
   ==================================================================================================================== */
class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 _panel; 
  lgfx::Bus_Parallel8 _bus;   

public:
  LGFX(void) {
    {
      auto cfg = _bus.config();
      cfg.pin_wr = 4;  cfg.pin_rd = 2;  cfg.pin_rs = 16;
      cfg.pin_d0 = 12; cfg.pin_d1 = 13; cfg.pin_d2 = 14; cfg.pin_d3 = 27;
      cfg.pin_d4 = 26; cfg.pin_d5 = 25; cfg.pin_d6 = 33; cfg.pin_d7 = 32;
      _bus.config(cfg);
      _panel.setBus(&_bus);
    }
    {
      auto cfg = _panel.config();
      cfg.pin_cs  = 5; 
      cfg.pin_rst = 17;
      cfg.panel_width  = 240; 
      cfg.panel_height = 320; 
      _panel.config(cfg);
      setPanel(&_panel);
    }
  };
};

LGFX tft;

/* ====================================================================================================================
   4. SYNCHRONIZATION OBJECTS (RTOS INTER-TASK COMMUNICATION)
   ==================================================================================================================== */
SemaphoreHandle_t spiMutex;   // Melindungi akses SPI (CAN Bus)
SemaphoreHandle_t i2cMutex;   // Melindungi akses I2C (PCF8574) - FIX: Wire.h tidak thread safe!
SemaphoreHandle_t dataMutex;  // Mutex umum (jika diperlukan)
QueueHandle_t epsQueue;       // Queue untuk mengirim data EPS dari Core 0 ke Core 1 secara aman

// Spinlock untuk variabel global kecil (lebih cepat dari Mutex untuk variable biasa)
portMUX_TYPE dataMux = portMUX_INITIALIZER_UNLOCKED;

/* ====================================================================================================================
   5. GLOBAL VARIABLES & CAN OBJECT
   ==================================================================================================================== */
MCP_CAN CAN(CAN_CS);
byte ioExpanderState = 0xFF; // Default semua HIGH (Pull-up PCF8574)

// Variabel data kendaraan (Dilindungi Critical Section)
uint16_t rpm = 0;
byte speed = 0;
bool engineRunning = false;
int torqueVal = 0;
float voltageVal = 12.0;
unsigned long lastEPSRespTime = 0;

/* ====================================================================================================================
   6. SAFE ACCESSOR FUNCTIONS (CRITICAL SECTION WRAPPERS)
   Mencegah data korupsi saat Core 0 (CAN) dan Core 1 (UI) menulis/membaca bersamaan
   ==================================================================================================================== */
void setRPM(uint16_t val) {
  portENTER_CRITICAL(&dataMux);
  rpm = val;
  portEXIT_CRITICAL(&dataMux);
}

uint16_t getRPM() {
  uint16_t val;
  portENTER_CRITICAL(&dataMux);
  val = rpm;
  portEXIT_CRITICAL(&dataMux);
  return val;
}

void setSpeed(byte val) {
  portENTER_CRITICAL(&dataMux);
  speed = val;
  portEXIT_CRITICAL(&dataMux);
}

byte getSpeed() {
  byte val;
  portENTER_CRITICAL(&dataMux);
  val = speed;
  portEXIT_CRITICAL(&dataMux);
  return val;
}

void setEngineState(bool state) {
  portENTER_CRITICAL(&dataMux);
  engineRunning = state;
  portEXIT_CRITICAL(&dataMux);
}

bool getEngineState() {
  bool val;
  portENTER_CRITICAL(&dataMux);
  val = engineRunning;
  portEXIT_CRITICAL(&dataMux);
  return val;
}

void setTorque(int val) {
  portENTER_CRITICAL(&dataMux);
  torqueVal = val;
  portEXIT_CRITICAL(&dataMux);
}

int getTorque() {
  int val;
  portENTER_CRITICAL(&dataMux);
  val = torqueVal;
  portEXIT_CRITICAL(&dataMux);
  return val;
}

void setVoltage(float val) {
  portENTER_CRITICAL(&dataMux);
  voltageVal = val;
  portEXIT_CRITICAL(&dataMux);
}

float getVoltage() {
  float val;
  portENTER_CRITICAL(&dataMux);
  val = voltageVal;
  portEXIT_CRITICAL(&dataMux);
  return val;
}

void setLastEPSTime(unsigned long time) {
  portENTER_CRITICAL(&dataMux);
  lastEPSRespTime = time;
  portEXIT_CRITICAL(&dataMux);
}

unsigned long getLastEPSTime() {
  unsigned long val;
  portENTER_CRITICAL(&dataMux);
  val = lastEPSRespTime;
  portEXIT_CRITICAL(&dataMux);
  return val;
}

/* ====================================================================================================================
   7. OPTIMIZED GRAPHICS FUNCTIONS
   ==================================================================================================================== */
void fillGradientRect(int x, int y, int w, int h, uint16_t color1, uint16_t color2, bool vertical = true) {
  uint8_t r1 = (color1 >> 8) & 0xF8; 
  uint8_t g1 = (color1 >> 3) & 0xFC; 
  uint8_t b1 = (color1 << 3) & 0xF8;
  
  uint8_t r2 = (color2 >> 8) & 0xF8; 
  uint8_t g2 = (color2 >> 3) & 0xFC; 
  uint8_t b2 = (color2 << 3) & 0xF8;
  
  int steps = vertical ? h : w;
  int stepSize = 2; // Optimasi: Skip setiap baris untuk meningkatkan kecepatan 2x
  
  for(int i = 0; i < steps; i += stepSize) {
    float ratio = (float)i / steps;
    uint8_t r = r1 + (r2 - r1) * ratio;
    uint8_t g = g1 + (g2 - g1) * ratio;
    uint8_t b = b1 + (b2 - b1) * ratio;
    uint16_t color = tft.color565(r, g, b);
    
    if(vertical) {
      tft.drawFastHLine(x, y + i, w, color);
      if(i + 1 < steps) tft.drawFastHLine(x, y + i + 1, w, color);
    } else {
      tft.drawFastVLine(x + i, y, h, color);
      if(i + 1 < steps) tft.drawFastVLine(x + i + 1, y, h, color);
    }
  }
}

/* ====================================================================================================================
   8. I2C & IO EXPANDER FUNCTIONS (THREAD-SAFE)
   ==================================================================================================================== */
bool safeI2CWrite(uint8_t addr, uint8_t data) {
  // FIX: Wajib pakai Mutex. Jika tidak, saat Core 0 baca I2C bersamaan dengan Core 1 scan Keypad, 
  // ESP32 akan Guru Meditation Error.
  if(xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    Wire.beginTransmission(addr);
    Wire.write(data);
    bool ok = (Wire.endTransmission() == 0);
    xSemaphoreGive(i2cMutex);
    return ok;
  }
  return false;
}

bool safeI2CRead(uint8_t addr, uint8_t *data) {
  if(xSemaphoreTake(i2cMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    if(Wire.requestFrom(addr, (uint8_t)1) == 1) {
      *data = Wire.read();
      xSemaphoreGive(i2cMutex);
      return true;
    }
    xSemaphoreGive(i2cMutex);
  }
  return false;
}

void updateIOExpander() {
  safeI2CWrite(IO_EXP_ADDR, ioExpanderState);
}

void setLED(bool state) {
  if (state) {
    ioExpanderState &= ~(1 << LED_BIT); // Active Low -> Set 0 untuk NYALA
  } else {
    ioExpanderState |= (1 << LED_BIT);  // Active Low -> Set 1 untuk MATI
  }
  updateIOExpander();
}

void blinkLED(int times) {
  for(int i = 0; i < times; i++) {
    setLED(true);  vTaskDelay(100 / portTICK_PERIOD_MS);
    setLED(false); vTaskDelay(100 / portTICK_PERIOD_MS);
  }
}

/* ====================================================================================================================
   9. START SIGNAL HANDLER (WITH HARDWARE DEBOUNCE)
   ==================================================================================================================== */
bool getStartSignal() {
  static bool lastState = false;
  static unsigned long lastDebounceTime = 0;
  static bool stableState = false;
  
  // Set pin HIGH untuk membaca logika tombol
  ioExpanderState |= (1 << START_BIT);
  updateIOExpander();
  
  uint8_t data;
  if(!safeI2CRead(IO_EXP_ADDR, &data)) {
    return stableState; // Jika I2C gagal, kembalikan state terakhir
  }
  
  bool currentState = !(data & (1 << START_BIT)); // Active Low check
  
  // Logic Debounce
  if(currentState != lastState) {
    lastDebounceTime = millis();
    lastState = currentState;
  }
  
  if((millis() - lastDebounceTime) > DEBOUNCE_TIME) {
    stableState = currentState;
  }
  
  return stableState;
}

/* ====================================================================================================================
   10. KEYPAD SCANNING (NON-BLOCKING & THREAD-SAFE)
   ==================================================================================================================== */
const byte ROWS = 4; 
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','4','7','*'},
  {'2','5','8','0'},
  {'3','6','9','#'},
  {'A','B','C','D'}
};

char readRawKey() {
  for (int r = 0; r < ROWS; r++) {
    byte rowMask = 0xFF; 
    bitClear(rowMask, r); // Pull-down baris ke-r
    
    if(!safeI2CWrite(KEYPAD_ADDR, rowMask)) {
      continue; // Skip jika I2C sibuk
    }
    
    vTaskDelay(1); // Beri waktu sinyal stabil (sangat singkat, non-blocking)
    
    uint8_t data;
    if(!safeI2CRead(KEYPAD_ADDR, &data)) {
      continue;
    }
    
    // Cek kolom 1-4 (terhubung di bit 4,5,6,7)
    for (int c = 0; c < COLS; c++) {
      if (!(data & (1 << (c + 4)))) {
        return keys[r][c];
      }
    }
  }
  return 0;
}

char getKey() {
  static unsigned long lastKeyTime = 0;
  static char lastKey = 0;
  
  char rawKey = readRawKey();
  
  // Software debounce: Abaikan jika tombol sama ditekan dalam 200ms
  if(rawKey != 0 && rawKey == lastKey && (millis() - lastKeyTime) < 200) {
    return 0;
  }
  
  if(rawKey != 0) {
    lastKey = rawKey;
    lastKeyTime = millis();
    return rawKey;
  }
  
  return 0;
}

/* ====================================================================================================================
   11. DATA STRUCTURES
   ==================================================================================================================== */
struct EPS_Response {
  byte mode; 
  byte len; 
  byte data[8]; 
  bool available = false;
};

struct CanFrame {
  unsigned long id; 
  byte len; 
  byte data[8];
};

#define LOG_SIZE 10
struct LogEntry { 
  char buf[40];  // Diperbesar dari 30, untuk menghindari memory corruption
  uint16_t color; 
};
LogEntry canLog[LOG_SIZE];
int logIndex = 0;

/* ====================================================================================================================
   12. MENU STATE MACHINE & ANIMATION GLOBALS
   ==================================================================================================================== */
enum MenuState {
  MENU_UTAMA, 
  MENU_SPEEDO, 
  MENU_CAN_MON, 
  MENU_EPS_DIAG, 
  MENU_EPS_LIVE, 
  MENU_TORQUE_STREAM,   
  MENU_VOLTAGE_STREAM   
};

MenuState currentMenu = MENU_UTAMA;
bool redrawScreen = true;
int prevSpeedAngle = -1;
int prevRpmBarWidth = 0;

int menuAnimState = 0; 
unsigned long animTimer = 0;
int introProgress = 0;
float radarAngle = 0;
float waveOffset = 0;

String toastMsg = "";
unsigned long toastTimer = 0;

void showToast(String msg) {
  toastMsg = msg;
  toastTimer = millis() + 1500;
  redrawScreen = true;
}

/* ====================================================================================================================
   13. CAN SEND FUNCTIONS (MUTEX PROTECTED)
   ==================================================================================================================== */
static uint8_t rollingCounter = 0;

// Frame Request UDS
byte reqTorque[8]  = {0x02, UDS_REQUEST, PID_TORQUE, 0x00, 0x00, 0x00, 0x00, 0x00};
byte reqBattery[8] = {0x02, UDS_REQUEST, PID_BATTERY, 0x00, 0x00, 0x00, 0x00, 0x00};

bool safeCANSend(unsigned long id, byte ext, byte len, byte *data) {
  // FIX: JANGAN gunakan portMAX_DELAY! Jika UI freeze, CAN task akan ikut nunggu selamanya (Deadlock).
  // Gunakan timeout 10ms. Jika sibuk, skip pengiriman (lebih baik hilang 1 frame daripada restart).
  if(xSemaphoreTake(spiMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
    byte result = CAN.sendMsgBuf(id, ext, len, data);
    xSemaphoreGive(spiMutex);
    return (result == CAN_OK);
  }
  return false;
}

void sendCANRequest(byte *data) {
  safeCANSend(EPS_REQUEST_ID, 0, 8, data);
}

void sendBroadcastToEPS() {
  uint8_t txBuf[8];
  txBuf[0] = getSpeed();
  txBuf[1] = 0x00;
  txBuf[2] = (getRPM() >> 8) & 0xFF;
  txBuf[3] = getRPM() & 0xFF;
  txBuf[4] = EPS_STATUS_BYTE;
  txBuf[5] = 0x00;
  txBuf[6] = 0x00;
  txBuf[7] = rollingCounter;
  
  safeCANSend(BROADCAST_ID, 0, 8, txBuf);
  
  // Increment rolling counter (0-15)
  rollingCounter = (rollingCounter + 1) & 0x0F;
}

void sendRPM() {
  byte data[8] = {0x04, UDS_RESPONSE, PID_RPM, 0x00, 0x00, 0x00, 0x00, 0x00};
  data[3] = (getRPM() >> 8) & 0xFF; 
  data[4] = getRPM() & 0xFF;        
  safeCANSend(EPS_RESPONSE_ID, 0, 8, data);
}

void sendSpeed() {
  byte data[8] = {0x04, UDS_RESPONSE, PID_SPEED, 0x00, 0x00, 0x00, 0x00, 0x00};
  data[3] = (getSpeed() >> 8) & 0xFF;
  data[4] = getSpeed() & 0xFF;
  safeCANSend(EPS_RESPONSE_ID, 0, 8, data);
}

/* ====================================================================================================================
   14. BOOT ANIMATION (STATE MACHINE - NON BLOCKING)
   ==================================================================================================================== */
void drawLogoFrame(int cx, int cy, int radius, float angleOffset, uint16_t color) {
  tft.drawCircle(cx, cy, radius, color);
  tft.drawCircle(cx, cy, radius - 2, tft.color565(30, 30, 30)); 
  
  tft.fillCircle(cx, cy, 10, color);
  tft.fillCircle(cx, cy, 6, TFT_DARKGREY);

  for(int i = 0; i < 3; i++) {
    float angle = (i * 120 + angleOffset) * DEG_TO_RAD;
    int x1 = cx + cos(angle) * 15;
    int y1 = cy + sin(angle) * 15;
    int x2 = cx + cos(angle) * (radius - 5);
    int y2 = cy + sin(angle) * (radius - 5);
    tft.drawLine(x1, y1, x2, y2, color);
    
    int px = cx + cos(angle) * (radius - 8);
    int py = cy + sin(angle) * (radius - 8);
    tft.fillCircle(px, py, 3, color);
  }
}

enum BootState { 
  BOOT_INIT, 
  BOOT_IO, 
  BOOT_SPI, 
  BOOT_CAN, 
  BOOT_READY, 
  BOOT_DONE 
};

BootState bootState = BOOT_INIT;
int bootProgress = 0;
int currentRadius = 0;
float bootAngle = 0.0;

bool runBootAnimationStep() {
  int cx = 160, cy = 100;
  
  switch(bootState) {
    case BOOT_INIT:
      tft.fillScreen(TFT_BLACK);
      fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
      tft.setTextColor(TFT_ORANGE);
      tft.setTextSize(3);
      tft.setCursor(60, 170);
      tft.print("EPS SYSTEM");
      tft.drawRoundRect(40, 220, 240, 15, 5, TFT_DARKGREY);
      bootState = BOOT_IO;
      bootProgress = 0;
      return false;
      
    case BOOT_IO:
      bootProgress += 2;
      tft.fillRoundRect(42, 222, map(bootProgress, 0, 100, 0, 236), 11, 3, TFT_ORANGE);
      
      if(bootProgress == 20) {
        tft.fillRect(100, 200, 150, 20, TFT_BLACK); 
        tft.setTextColor(TFT_CYAN);
        tft.setTextSize(1);
        tft.setCursor(130, 200); 
        tft.print("CHECK IO");
        updateIOExpander();
        setLED(true);
      }
      
      if(bootProgress >= 25) {
        bootState = BOOT_SPI;
        bootProgress = 25;
      }
      return false;
      
    case BOOT_SPI:
      bootProgress += 2;
      tft.fillRoundRect(42, 222, map(bootProgress, 0, 100, 0, 236), 11, 3, TFT_ORANGE);
      
      if(bootProgress == 35) {
        tft.fillRect(100, 200, 150, 20, TFT_BLACK); 
        tft.setCursor(130, 200); 
        tft.print("INIT SPI");
        SPI.begin(SPI_SCK, SPI_MISO, SPI_MOSI, CAN_CS);
      }
      
      // Animasi logo secara paralel
      if(currentRadius < 50) currentRadius += 2;
      tft.fillCircle(cx, cy, currentRadius + 5, TFT_BLACK);
      bootAngle += 3.0;
      drawLogoFrame(cx, cy, currentRadius, bootAngle, TFT_ORANGE);
      
      if(bootProgress >= 50) {
        bootState = BOOT_CAN;
        bootProgress = 50;
      }
      return false;
      
    case BOOT_CAN:
      bootProgress += 2;
      tft.fillRoundRect(42, 222, map(bootProgress, 0, 100, 0, 236), 11, 3, TFT_ORANGE);
      
      if(bootProgress == 60) {
        tft.fillRect(100, 200, 150, 20, TFT_BLACK); 
        tft.setCursor(130, 200); 
        tft.print("INIT CAN");
        
        // FIX: CAN Init dengan retry mechanism
        bool canOk = false;
        for(int retry = 0; retry < 5; retry++) {
          if(CAN.begin(MCP_ANY, CAN_SPEED, CAN_CLOCK) == CAN_OK) {
            CAN.setMode(MCP_NORMAL);
            canOk = true;
            break;
          }
          vTaskDelay(50 / portTICK_PERIOD_MS);
        }
        
        if(!canOk) {
          tft.fillCircle(cx, cy, 55, TFT_RED);
          tft.setTextColor(TFT_WHITE);
          tft.setCursor(120, 95);
          tft.print("CAN ERR");
          vTaskDelay(1000 / portTICK_PERIOD_MS);
        }
      }
      
      if(bootProgress >= 75) {
        bootState = BOOT_READY;
        bootProgress = 75;
      }
      return false;
      
    case BOOT_READY:
      bootProgress += 2;
      tft.fillRoundRect(42, 222, map(bootProgress, 0, 100, 0, 236), 11, 3, TFT_ORANGE);
      
      if(bootProgress == 80) {
        tft.fillRect(100, 200, 150, 20, TFT_BLACK); 
        tft.setCursor(130, 200); 
        tft.print("READY");
      }
      
      if(bootProgress >= 100) {
        bootState = BOOT_DONE;
        tft.fillCircle(cx, cy, 55, TFT_BLACK);
        drawLogoFrame(cx, cy, 50, bootAngle, TFT_WHITE);
      }
      return false;
      
    case BOOT_DONE:
      return true;  // Boot selesai, lanjut ke RTOS Tasks
  }
  return false;
}

/* ====================================================================================================================
   15. TASK 0 - CAN & LOGIC (DIJALANKAN DI CORE 0)
   ==================================================================================================================== */
void Task0Code(void * parameter) {
  bool lastStartState = false;
  unsigned long startPressTime = 0;
  bool toggleDone = false;
  float lastSpeed = 0;
  const float filterAlpha = 0.1; // Low Pass Filter untuk Potensiometer

  unsigned long lastRequestTime = 0;
  bool requestBatteryNext = false; 
  unsigned long lastBroadcast = 0;

  for(;;) {
    // === 1. START BUTTON HANDLING ===
    bool currentStartState = getStartSignal();
    
    if(currentStartState && !lastStartState) {
      startPressTime = millis();
      toggleDone = false;
    }
    
    if(currentStartState && !toggleDone && (millis() - startPressTime > 1000)) {
      setEngineState(!getEngineState());
      toggleDone = true;
      blinkLED(5); // Konfirmasi visual
    }
    
    lastStartState = currentStartState;

    // === 2. SIMULATED DATA UPDATE (POTENTIOMETER) ===
    if(getEngineState()) {
      int potValue = analogRead(POT_PIN);
      potValue = constrain(potValue, 50, 4000);
      
      // Filter agar pergerakan jarum speedo tidak tersentak-sentak
      float rawSpeed = map(potValue, 50, 4000, 0, 140);
      lastSpeed = (filterAlpha * rawSpeed) + ((1.0 - filterAlpha) * lastSpeed);
      setSpeed((byte)lastSpeed);
      setRPM(map(lastSpeed, 0, 140, 700, 2500));
      
      // Kirim request UDS bergantian setiap 500ms
      if(millis() - lastRequestTime > REQUEST_INTERVAL) {
        lastRequestTime = millis();
        if(requestBatteryNext) {
          sendCANRequest(reqBattery); 
        } else {
          sendCANRequest(reqTorque);  
        }
        requestBatteryNext = !requestBatteryNext; 
      }
    } else {
      // Saat mesin mati, reset semua data simulasi
      setSpeed(0);
      setRPM(700);
      lastSpeed = 0;
      setTorque(0);
      setVoltage(12.0);
    }

    // === 3. CAN BROADCAST (10ms Interval) ===
    if(millis() - lastBroadcast > 10) {
      lastBroadcast = millis();
      sendBroadcastToEPS();
    }

    // === 4. CAN RECEIVE & PARSING ===
    // Pakai timeout pendek 2ms, agar tidak nge-block Task jika UI sedang kirim CAN
    if(xSemaphoreTake(spiMutex, pdMS_TO_TICKS(2)) == pdTRUE) {
      if(CAN.checkReceive() == CAN_MSGAVAIL) {
        CanFrame frame;
        CAN.readMsgBuf(&frame.id, &frame.len, frame.data);
        
        // Simpan ke Log Buffer
        int idx = logIndex % LOG_SIZE;
        snprintf(canLog[idx].buf, sizeof(canLog[idx].buf), "%03lX: ", frame.id);
        for(int i = 0; i < frame.len; i++) {
          snprintf(canLog[idx].buf + strlen(canLog[idx].buf), 
                   sizeof(canLog[idx].buf) - strlen(canLog[idx].buf), 
                   "%02X ", frame.data[i]);
        }
        
        // Warna log berdasarkan ID
        if(frame.id == BROADCAST_ID) canLog[idx].color = TFT_CYAN;
        else if(frame.id >= 0x7A0 && frame.id <= 0x7B0) canLog[idx].color = TFT_GREEN;
        else canLog[idx].color = TFT_YELLOW;
        logIndex++;

        // Parsing Response dari EPS
        if(frame.id == EPS_RESPONSE_ID && frame.data[1] == UDS_RESPONSE) {
          setLastEPSTime(millis());
          
          // Bungkus dalam struct dan kirim ke UI Task via Queue (Aman dari Race Condition)
          EPS_Response epsResp;
          epsResp.mode = UDS_RESPONSE;
          epsResp.len = frame.len;
          memcpy(epsResp.data, frame.data, 8);
          epsResp.available = true;
          xQueueSend(epsQueue, &epsResp, 0); // Non-blocking send
          
          // Update variabel data lokal
          if(frame.data[2] == PID_BATTERY && frame.len >= 5) {
            int raw = (frame.data[3] << 8) | frame.data[4];
            setVoltage(raw / VOLTAGE_DIVIDER);
          } 
          else if(frame.data[2] == PID_TORQUE && frame.len >= 4) {
            setTorque((int8_t)frame.data[3]);
          }
        }
        
        // Handle request masuk (jika device lain menanyakan RPM/Speed ke kita)
        if(frame.id == EPS_REQUEST_ID && frame.data[1] == UDS_REQUEST) {
          if(frame.data[2] == PID_RPM) sendRPM();
          if(frame.data[2] == PID_SPEED) sendSpeed();
        }
      }
      xSemaphoreGive(spiMutex);
    }

    // === 5. LED STATUS LOGIC ===
    if(getEngineState()) {
      // Jika data EPS tidak masuk > 1 detik, nyatakan EPS OFFLINE (LED Nyala)
      setLED(millis() - getLastEPSTime() >= EPS_TIMEOUT);
    } else {
      // Mesin off, LED selalu nyala (Standby)
      setLED(true);
    }
    
    // FIX: Beri jeda minimal 1 tick agar Watchdog Timer tidak keserempet
    vTaskDelay(1);
  }
}

/* ====================================================================================================================
   16. TASK 1 - UI LOOP (DIJALANKAN DI CORE 1)
   ==================================================================================================================== */
void Task1Code(void * parameter) {
  for(;;) {
    handleKeypad();
    drawUI();
    
    // Tampilkan Toast Message jika ada
    if(millis() < toastTimer) {
      tft.fillRoundRect(90, 200, 140, 30, 5, TFT_WHITE);
      tft.setTextColor(TFT_BLACK);
      tft.setTextSize(2);
      tft.setCursor(100, 207);
      tft.print(toastMsg);
    }
    
    // FIX WAJIB: Membatasi FPS menjadi ~30 FPS.
    // Jika tidak ada delay ini, Core 1 akan terus menggambar tanpa henti (CPU 100%),
    // yang menyebabkan Task lain kekurangan waktu, dan memicu TG1WDT_SYS_RESET.
    vTaskDelay(pdMS_TO_TICKS(UI_FPS_DELAY));
  }
}

/* ====================================================================================================================
   17. SETUP & LOOP
   ==================================================================================================================== */
void setup() {
  // 1. Inisialisasi I2C paling awal (Sebelum ada Task yang berjalan)
  Wire.begin(21, 22);
  Wire.setClock(400000);
  
  // 2. Buat semua mekanisme sinkronisasi
  spiMutex = xSemaphoreCreateMutex();
  i2cMutex = xSemaphoreCreateMutex(); // Kunci utama keamanan I2C
  dataMutex = xSemaphoreCreateMutex();
  epsQueue = xQueueCreate(5, sizeof(EPS_Response)); // Buffer 5 pesan
  
  Serial.begin(115200);
  pinMode(POT_PIN, INPUT);
  
  // 3. Inisialisasi Display
  tft.init(); 
  tft.setRotation(1);
  
  // 4. Jalankan Boot Animation (Non-blocking State Machine)
  while(!runBootAnimationStep()) {
    vTaskDelay(10 / portTICK_PERIOD_MS);
  }
  vTaskDelay(200 / portTICK_PERIOD_MS);
  
  // 5. Mulai FreeRTOS Tasks
  // Task CAN di Core 0 (10000 byte stack cukup, karena tidak ada sin/cos/snprintf besar)
  xTaskCreatePinnedToCore(Task0Code, "CAN_TASK", 10000, NULL, 2, NULL, 0);
  
  // Task UI di Core 1 (FIX: 16384 byte stack! Karena snprintf, sin, cos butuh stack besar. 
  // Jika dikurangi (misal 8192), akan muncul error: "Guru Meditation Error: Core 1 panic'ed (Stack overflow)")
  xTaskCreatePinnedToCore(Task1Code, "UI_TASK", 16384, NULL, 1, NULL, 1);
}

// FIX: Kosongkan loop() standard. 
// Semua pekerjaan sudah di-delegasikan ke masing-masing Task di Core 0 dan Core 1.
// Membiarkan loop() kosong adalah best practice di ESP32 RTOS agar tidak mengganggu Task scheduler.
void loop() {
  vTaskDelay(1000 / portTICK_PERIOD_MS);
}

/* ====================================================================================================================
   18. UI HANDLER & NAVIGATION
   ==================================================================================================================== */
void handleKeypad() {
  char key = getKey();
  if(key) {
    // Reset animasi saat pindah menu
    menuAnimState = 0; 
    introProgress = 0;
    redrawScreen = true;
    prevSpeedAngle = -1;
    prevRpmBarWidth = 0;

    if(key == 'A') { 
      currentMenu = MENU_EPS_LIVE; 
      sendCANRequest(reqTorque); 
      showToast("LIVE DATA"); 
    }
    else if(key == 'B') { 
      currentMenu = MENU_UTAMA; 
    }
    else if(key == 'C') { 
      currentMenu = MENU_CAN_MON; 
    }
    else {
       if(key == '0') {
         currentMenu = MENU_UTAMA;
       }
       else if(currentMenu == MENU_UTAMA) {
         if(key == '1') currentMenu = MENU_SPEEDO;
         if(key == '2') currentMenu = MENU_CAN_MON;
         if(key == '3') currentMenu = MENU_EPS_DIAG;
       }
       else if(currentMenu == MENU_EPS_DIAG) {
         if(key == '1') { 
           currentMenu = MENU_EPS_LIVE; 
           sendCANRequest(reqTorque); 
         }
         if(key == '2') { currentMenu = MENU_TORQUE_STREAM; }
         if(key == '3') { currentMenu = MENU_VOLTAGE_STREAM; }
       }
    }
  }
}

void drawUI() {
  switch(currentMenu) {
    case MENU_UTAMA:        drawMainMenu(); break;
    case MENU_SPEEDO:       drawSpeedo(); break;
    case MENU_CAN_MON:      drawCanMon(); break;
    case MENU_EPS_DIAG:     drawEPSDiagMenu(); break;
    case MENU_EPS_LIVE:     drawEPSLive(); break;
    case MENU_TORQUE_STREAM: drawTorqueStream(); break;
    case MENU_VOLTAGE_STREAM: drawVoltageStream(); break;
  }
}

/* ====================================================================================================================
   19. UI COMPONENTS (REUSABLE WIDGETS)
   ==================================================================================================================== */
void drawAnimatedButton(int x, int baseY, const char* label, uint16_t color, const char* icon, int animStep) {
  int y = baseY + (100 - animStep); 
  tft.fillRoundRect(x+3, y+3, 280, 40, 5, TFT_BLACK); // Shadow
  tft.fillRoundRect(x, y, 280, 40, 5, color);           // Body
  tft.fillCircle(x + 25, y + 20, 12, TFT_WHITE);        // Icon Circle
  tft.setTextColor(color);
  tft.setTextSize(2);
  tft.setCursor(x+19, y+13);
  tft.print(icon);
  tft.setTextColor(TFT_WHITE);
  tft.setCursor(x+50, y+10);
  tft.print(label);
}

void drawEngineStatusIndicator() {
  int x = 250, y = 10;
  static bool lastDrawnState = false;
  bool currentState = getEngineState();
  
  if(currentState != lastDrawnState || redrawScreen) {
    lastDrawnState = currentState;
    if(currentState) {
      tft.fillRoundRect(x, y, 60, 25, 5, TFT_GREEN);
      tft.setTextColor(TFT_BLACK); tft.setTextSize(2);
      tft.setCursor(x + 5, y + 5); tft.print("RUN");
    } else {
      tft.fillRoundRect(x, y, 60, 25, 5, TFT_RED);
      tft.setTextColor(TFT_WHITE); tft.setTextSize(2);
      tft.setCursor(x + 5, y + 5); tft.print("OFF");
    }
  }
}

/* ====================================================================================================================
   20. MENU DRAWINGS IMPLEMENTATION
   ==================================================================================================================== */
void drawMainMenu() {
  if(redrawScreen) {
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.fillRoundRect(10, 5, 300, 35, 5, 0x2104);
    tft.setTextColor(TFT_ORANGE);
    tft.setTextSize(2);
    tft.setCursor(20, 12);
    tft.print("SELECT MENU");
    redrawScreen = false;
    menuAnimState = 0; 
    animTimer = millis();
  }
  
  drawEngineStatusIndicator();

  if(menuAnimState == 0) {
    long elapsed = millis() - animTimer;
    // Perbaikan logika map agar animasi slide-in mulus
    if(elapsed < 300) {
      introProgress = map(elapsed, 0, 300, 0, 100);
    } else if(elapsed < 600) {
      introProgress = map(elapsed, 300, 600, 100, 200);
    } else if(elapsed < 900) {
      introProgress = map(elapsed, 600, 900, 200, 300);
    } else {
      introProgress = 300; 
      menuAnimState = 1; // Animasi selesai, masuk idle
    }
    
    tft.fillRect(0, 40, 320, 200, TFT_BLACK); 
    if(introProgress > 0)   drawAnimatedButton(20, 50,  "SPEEDOMETER", 0x02E0, "1", constrain(introProgress, 0, 100));
    if(introProgress > 100) drawAnimatedButton(20, 100, "DATA STREAM ", 0x041F, "2", constrain(introProgress-100, 0, 100));
    if(introProgress > 200) drawAnimatedButton(20, 150, "BATTRAY VOLTAGE", 0xF800, "3", constrain(introProgress-200, 0, 100));
  } 
  else {
    // Idle Animation: Tombol berkedip halus
    float pulse = sin(millis() / 200.0) * 3; 
    tft.fillCircle(45, 70, 12 + pulse, TFT_WHITE);
    tft.setTextColor(0x02E0); tft.setCursor(39, 63); tft.print("1");
    
    tft.fillCircle(45, 120, 12 + pulse, TFT_WHITE);
    tft.setTextColor(0x041F); tft.setCursor(39, 113); tft.print("2");
    
    tft.fillCircle(45, 170, 12 + pulse, TFT_WHITE);
    tft.setTextColor(0xF800); tft.setCursor(39, 163); tft.print("3");
  }
  
  tft.setTextColor(TFT_SILVER);
  tft.setTextSize(1);
  tft.setCursor(80, 220);
  tft.print("A:Live  B:Back  C:Mon");
}

void drawNeedle(int cx, int cy, int r, int angle, int color) {
  float rad = angle * DEG_TO_RAD;
  int x = cx + cos(rad) * r;
  int y = cy + sin(rad) * r;
  tft.drawLine(cx, cy, x, y, color);
  tft.fillCircle(cx, cy, 5, (color == TFT_BLACK) ? TFT_DARKGREY : color);
}

void drawSpeedo() {
  int cx = 160, cy = 130, r = 100;
  static bool introDone = false;
  static int sweepAngle = 135;
  static unsigned long lastSweepTime = 0;
  
  if(redrawScreen) {
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.drawCircle(cx, cy, r, TFT_ORANGE);
    for(int i = 0; i <= 180; i += 10) {
      float rad = (i + 135) * DEG_TO_RAD;
      int x1 = cx + cos(rad) * (r - 10);
      int y1 = cy + sin(rad) * (r - 10);
      uint16_t col = (i > 120) ? TFT_RED : (i > 60) ? TFT_ORANGE : TFT_GREEN;
      if(i % 20 == 0) tft.fillCircle(x1, y1, 3, col);
      else tft.fillCircle(x1, y1, 1, col);
    }
    redrawScreen = false;
    introDone = false;
    sweepAngle = 135;
    lastSweepTime = millis();
  }

  // Animasi Sweep saat pertama buka (Non-blocking)
  if(!introDone) {
    if(millis() - lastSweepTime >= 5) {
      lastSweepTime = millis();
      drawNeedle(cx, cy, 90, sweepAngle, TFT_BLACK); // Hapus jarum lama
      sweepAngle += 5;
      drawNeedle(cx, cy, 90, sweepAngle, TFT_RED);   // Gambar jarum baru
      
      if(sweepAngle >= 405) {
        introDone = true;
        tft.fillCircle(cx, cy, 95, TFT_BLACK); 
        tft.drawCircle(cx, cy, r, TFT_ORANGE);
        // Redraw tick marks yang tertutup jarum
        for(int i = 0; i <= 180; i += 20) {
          float rad = (i + 135) * DEG_TO_RAD;
          int x1 = cx + cos(rad) * (r - 10);
          int y1 = cy + sin(rad) * (r - 10);
          uint16_t col = (i > 120) ? TFT_RED : (i > 60) ? TFT_ORANGE : TFT_GREEN;
          tft.fillCircle(x1, y1, 3, col);
        }
      }
    }
    return;
  }

  // Indikator Start/Stop Engine
  static bool lastEngineState = false;
  bool engState = getEngineState();
  if(engState != lastEngineState) {
    lastEngineState = engState;
    tft.fillRoundRect(230, 5, 80, 30, 5, engState ? TFT_GREEN : TFT_RED);
    tft.setTextColor(engState ? TFT_BLACK : TFT_WHITE);
    tft.setTextSize(2);
    tft.setCursor(240, 12); 
    tft.print(engState ? "START" : "OFF");
  }
  
  // Ambil data yang sudah di-protect
  uint16_t currentRPM = getRPM();
  byte currentSpeed = getSpeed();
  
  // Gambar Jarum Speedometer
  int angle = map(currentSpeed, 0, 140, 135, 45);
  if(prevSpeedAngle != angle) {
    if(prevSpeedAngle != -1) drawNeedle(cx, cy, 90, prevSpeedAngle, TFT_BLACK);
    drawNeedle(cx, cy, 90, angle, TFT_RED);
    prevSpeedAngle = angle;
    
    // Redraw ticks yang mungkin tertimpa jarum
    for(int i = 0; i <= 180; i += 20) {
      float rad = (i + 135) * DEG_TO_RAD;
      int x1 = cx + cos(rad) * (r - 10);
      int y1 = cy + sin(rad) * (r - 10);
      uint16_t col = (i > 120) ? TFT_RED : (i > 60) ? TFT_ORANGE : TFT_GREEN;
      tft.fillCircle(x1, y1, 3, col);
    }
  }
  
  // Teks Digital Speed
  tft.setTextSize(3);
  tft.setTextColor(TFT_WHITE, TFT_BLACK); 
  tft.setCursor(120, 85);
  if(currentSpeed < 100) tft.print(" ");
  if(currentSpeed < 10) tft.print(" ");
  tft.print(currentSpeed);
  tft.setTextSize(1); 
  tft.print(" KM/H");

  // Teks Digital RPM
  tft.setTextSize(2);
  tft.setCursor(100, 115);
  tft.print(currentRPM); 
  tft.print(" RPM");

  // Bar Graph RPM
  int rpmBarWidth = map(currentRPM, 700, 2500, 0, 300);
  if(rpmBarWidth < 0) rpmBarWidth = 0;
  
  if(rpmBarWidth != prevRpmBarWidth) {
    if(prevRpmBarWidth > 0) tft.fillRect(10, 225, 300, 10, TFT_BLACK);
    uint16_t barColor = currentRPM > 2000 ? TFT_RED : (currentRPM > 1500 ? TFT_ORANGE : TFT_GREEN);
    tft.fillRect(10, 225, rpmBarWidth, 10, barColor);
    prevRpmBarWidth = rpmBarWidth;
  }
}

void drawCanMon() {
  if(redrawScreen) { 
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(TFT_YELLOW);
    tft.setCursor(10, 5); 
    tft.println("DATA PARAMETER");
    tft.drawFastHLine(0, 25, 320, TFT_DARKGREY);
    redrawScreen = false;
  }
  
  // Baca data secara aman
  bool engRun = getEngineState();
  byte spd = getSpeed();
  uint16_t rpmVal = getRPM();
  float volt = getVoltage();
  int trq = getTorque();
  bool epsOnline = (millis() - getLastEPSTime() < EPS_TIMEOUT);

  int yPos = 35;
  int lineH = 28;
  tft.setTextSize(2);

  // Engine Status
  tft.setTextColor(TFT_WHITE, TFT_BLACK); tft.setCursor(10, yPos); tft.print("Engine : ");
  tft.setTextColor(engRun ? TFT_GREEN : TFT_RED, TFT_BLACK); tft.print(engRun ? "RUNNING" : "OFF");
  tft.print("      "); yPos += lineH;

  // Speed
  tft.setTextColor(TFT_WHITE, TFT_BLACK); tft.setCursor(10, yPos); tft.print("Speed  : ");
  tft.setTextColor(TFT_CYAN, TFT_BLACK); tft.print(spd);
  tft.print(" km/h   "); yPos += lineH;

  // RPM
  tft.setTextColor(TFT_WHITE, TFT_BLACK); tft.setCursor(10, yPos); tft.print("RPM    : ");
  tft.setTextColor(TFT_ORANGE, TFT_BLACK); tft.print(rpmVal);
  tft.print("      "); yPos += lineH;

  // Voltage
  tft.setTextColor(TFT_WHITE, TFT_BLACK); tft.setCursor(10, yPos); tft.print("Voltage: ");
  tft.setTextColor(TFT_YELLOW, TFT_BLACK); tft.print(volt, 1); 
  tft.print(" V    "); yPos += lineH;

  // Torque
  tft.setTextColor(TFT_WHITE, TFT_BLACK); tft.setCursor(10, yPos); tft.print("Torque : ");
  tft.setTextColor(TFT_GREEN, TFT_BLACK); tft.print(trq);
  tft.print(" Nm     "); yPos += lineH;

  // EPS Status
  tft.setTextColor(TFT_WHITE, TFT_BLACK); tft.setCursor(10, yPos); tft.print("EPS    : ");
  tft.setTextColor(epsOnline ? TFT_GREEN : TFT_RED, TFT_BLACK); 
  tft.print(epsOnline ? "ONLINE " : "OFFLINE");
  
  tft.setTextColor(TFT_SILVER);
  tft.setTextSize(1);
  tft.setCursor(100, 220);
  tft.print("B: Back to Menu");
}

void drawEPSDiagMenu() {
  if(redrawScreen) {
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.fillRoundRect(10, 5, 300, 35, 5, 0x4208);
    tft.setTextColor(TFT_ORANGE);
    tft.setTextSize(2);
    tft.setCursor(20, 12);
    tft.print("EPS DIAGNOSTIC");
    redrawScreen = false;
    menuAnimState = 0;
    animTimer = millis();
  }

  long elapsed = millis() - animTimer;
  
  // Animasi Bounce (Perbaikan matematika map)
  int y1 = 50;
  if(elapsed < 300) y1 = 100 - map(elapsed, 0, 300, 0, 50);
  else if(elapsed < 400) y1 = 50 + map(elapsed, 300, 400, 0, 10);
  else if(elapsed < 500) y1 = 60 - map(elapsed, 400, 500, 0, 10);

  int y2 = 100;
  if(elapsed < 400) y2 = 150 - map(elapsed, 0, 300, 0, 50);
  else if(elapsed < 500) y2 = 100 + map(elapsed, 400, 500, 0, 10);
  else if(elapsed < 600) y2 = 110 - map(elapsed, 500, 600, 0, 10);

  int y3 = 150;
  if(elapsed < 500) y3 = 200 - map(elapsed, 0, 300, 0, 50);
  else if(elapsed < 600) y3 = 150 + map(elapsed, 500, 600, 0, 10);
  else if(elapsed < 700) y3 = 160 - map(elapsed, 600, 700, 0, 10);

  tft.fillRect(0, 40, 320, 160, TFT_BLACK);

  drawAnimatedButton(20, y1, "LIVE DATA", TFT_CYAN, "1", 100);
  drawAnimatedButton(20, y2, "TORQUE STREAM", TFT_YELLOW, "2", 100);
  drawAnimatedButton(20, y3, "VOLTAGE STREAM", TFT_RED, "3", 100);
  
  bool epsOnline = (millis() - getLastEPSTime() < EPS_TIMEOUT);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(20, 200);
  tft.print("Status: ");
  tft.setTextColor(epsOnline ? TFT_GREEN : TFT_RED);
  tft.print(epsOnline ? "ONLINE " : "OFFLINE");
}

void drawEPSLive() {
  if(redrawScreen) { 
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(TFT_CYAN);
    tft.setCursor(10, 10); 
    tft.println("EPS LIVE DATA");
    redrawScreen = false;
    radarAngle = 0;
  }
  
  int cx = 160, cy = 120;
  
  // Gambar Grid Radar
  tft.drawCircle(cx, cy, 80, tft.color565(0, 50, 0));
  tft.drawCircle(cx, cy, 60, tft.color565(0, 50, 0));
  tft.drawCircle(cx, cy, 40, tft.color565(0, 50, 0));
  tft.drawFastHLine(cx - 80, cy, 160, tft.color565(0, 50, 0));
  tft.drawFastVLine(cx, cy - 80, 160, tft.color565(0, 50, 0));

  // Animasi Garis Sweep Radar
  radarAngle += 4;
  if(radarAngle >= 360) radarAngle = 0;
  
  float rad = radarAngle * DEG_TO_RAD;
  tft.drawLine(cx, cy, cx + cos(rad) * 80, cy + sin(rad) * 80, TFT_GREEN);
  
  // Efek Fade pada ekor garis
  for(int i = 1; i <= 3; i++) {
    float prevRad = (radarAngle - i * 10) * DEG_TO_RAD;
    uint8_t greenVal = max(0, 80 - i * 25);
    tft.drawLine(cx, cy, cx + cos(prevRad) * 80, cy + sin(prevRad) * 80, tft.color565(0, greenVal, 0));
  }

  // Baca data dari Queue (Aman, tidak crash)
  EPS_Response resp;
  if(xQueueReceive(epsQueue, &resp, 0)) {
    tft.fillRoundRect(5, 25, 150, 50, 3, TFT_BLACK);
    tft.setTextSize(2);
    if(resp.mode == UDS_RESPONSE) {
      tft.setTextColor(TFT_GREEN, TFT_BLACK);
      tft.setCursor(10, 30); 
      tft.print("DATA OK");
      int val1 = resp.data[2];
      tft.fillRect(10, 210, map(val1, 0, 255, 0, 300), 20, TFT_CYAN);
    } else if(resp.mode == UDS_NEGATIVE) {
      tft.setTextColor(TFT_RED, TFT_BLACK);
      tft.setCursor(10, 30);
      tft.print("ERROR");
    }
  }
}

void drawTorqueStream() {
  if(redrawScreen) { 
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(TFT_YELLOW);
    tft.setCursor(10, 10); 
    tft.println("TORQUE STREAM");
    tft.drawFastHLine(0, 30, 320, TFT_DARKGREY);
    redrawScreen = false; 
  }

  int trq = getTorque();
  int tAbs = abs(trq);
  
  // Value besar
  tft.setTextSize(4);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(110, 60);
  if(tAbs < 100) tft.print(" ");
  if(tAbs < 10) tft.print(" ");
  tft.print(tAbs); 
  tft.setTextSize(2);
  tft.print(" Nm");

  // Arah Torque
  tft.setTextSize(2);
  tft.setCursor(140, 100);
  if(trq > 5) {
    tft.setTextColor(TFT_GREEN, TFT_BLACK); 
    tft.print("RIGHT >>");
  } else if(trq < -5) {
    tft.setTextColor(TFT_RED, TFT_BLACK); 
    tft.print("<< LEFT");
  } else {
    tft.setTextColor(TFT_SILVER, TFT_BLACK); 
    tft.print("CENTER  ");
  }

  // Bar Graph Horizontal
  int barY = 140, barH = 30, barCenter = 160;
  tft.fillRect(10, barY, 300, barH, TFT_DARKGREY);
  tft.drawFastVLine(barCenter, barY, barH, TFT_WHITE);

  int barWidth = map(tAbs, 0, 100, 0, 150);
  if(trq >= 0) {
    tft.fillRect(barCenter, barY + 2, barWidth, barH - 4, TFT_GREEN);
  } else {
    tft.fillRect(barCenter - barWidth, barY + 2, barWidth, barH - 4, TFT_RED);
  }

  // Animasi Gelombang bawah
  waveOffset += 0.2;
  for(int i = 0; i < 320; i += 5) {
    int y = 190 + sin(waveOffset + i / 10.0) * 5;
    tft.drawPixel(i, y, TFT_YELLOW);
  }
}

void drawVoltageStream() {
  if(redrawScreen) { 
    fillGradientRect(0, 0, 320, 240, 0x1082, TFT_BLACK);
    tft.setTextSize(2);
    tft.setTextColor(TFT_ORANGE);
    tft.setCursor(10, 10); 
    tft.println("VOLTAGE STREAM");
    tft.drawFastHLine(0, 30, 320, TFT_DARKGREY);
    redrawScreen = false; 
  }

  float volt = getVoltage();
  
  // Nilai Voltage Besar
  tft.setTextSize(5);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setCursor(80, 70);
  tft.print(volt, 1); 
  tft.setTextSize(3);
  tft.print(" V  ");

  // Gambar Icon Baterai
  int battX = 110, battY = 140, battW = 100, battH = 50;
  tft.drawRoundRect(battX, battY, battW, battH, 5, TFT_WHITE); 
  tft.fillRoundRect(battX + battW, battY + 15, 10, 20, 2, TFT_WHITE); // Kutub baterai

  // Isi baterai berdasarkan voltage
  int fillW = constrain(map(volt * 10, 100, 150, 0, battW - 4), 0, battW - 4);
  uint16_t fillColor = (volt < 12.0) ? TFT_RED : (volt < 13.0) ? TFT_YELLOW : TFT_GREEN;
  
  // FIX: Syntax error penutup kurung yang sebelumnya hilang sudah diperbaiki di baris ini
  tft.fillRoundRect(battX + 2, battY + 2, fillW, battH - 4, 3, fillColor);

  // Teks Status Baterai
  tft.setTextSize(2);
  tft.setCursor(120, 200);
  if(volt < 11.5) {
    tft.setTextColor(TFT_RED);
    tft.print("LOW BATT!");
  } else if(volt > 14.5) {
    tft.setTextColor(TFT_YELLOW);
    tft.print("HIGH!");
  } else {
    tft.setTextColor(TFT_GREEN);
    tft.print("NORMAL  ");
  }
}