/*******************************************************

HAKATECH DASHBOARD V6 ULTIMATE (FIXED COMPILATION)

ARCHITECTURE: Dual Core
-> Core 0 (Pro): Logic, Safety, CAN, Buzzer Manager
-> Core 1 (App): Precision Graphics, Float Rendering

FIXES (V6 FINAL - ESP32 S3 COMPATIBLE):
- Compilation Error Fixed: Scope of currentMillis in updateDashboard
- Compilation Error Fixed: TFT_DARKRED changed to TFT_MAROON
- COMPATIBILITY FIX: VSPI_HOST changed to SPI3_HOST for ESP32-S3
- All previous fixes (Float Math, Strict Filter, Safety Logic) retained

********************************************************/

#include <LovyanGFX.hpp>
#include <SPI.h>
#include <mcp_can.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

// --- KONFIGURASI PIN (LCD) ---
class LGFX : public lgfx::LGFX_Device {
public:
  lgfx::Panel_ILI9486 _panel_instance;
  lgfx::Bus_SPI       _bus_instance;
  lgfx::Touch_XPT2046 _touch_instance;

  LGFX(void) {
    { // Bus SPI
      auto cfg = _bus_instance.config();
      // FIX UNTUK ESP32-S3: Gunakan SPI3_HOST bukan VSPI_HOST
      cfg.spi_host = SPI3_HOST; 
      cfg.spi_mode = 0;
      cfg.freq_write = 40000000; 
      cfg.pin_sclk = 18; cfg.pin_mosi = 23; cfg.pin_miso = 19; cfg.pin_dc = 2;
      _bus_instance.config(cfg); _panel_instance.setBus(&_bus_instance);
    }
    { // Panel LCD
      auto cfg = _panel_instance.config();
      cfg.pin_cs = 15; cfg.pin_rst = 4; cfg.panel_width = 800; cfg.panel_height = 480; cfg.invert = true; 
      _panel_instance.config(cfg);
    }
    { // Touchscreen
      auto cfg = _touch_instance.config();
      cfg.x_min = 200; cfg.x_max = 3800; cfg.y_min = 200; cfg.y_max = 3800;
      cfg.pin_cs = 21; cfg.freq = 2500000; cfg.bus_shared = true;
      _touch_instance.config(cfg); _panel_instance.setTouch(&_touch_instance);
    }
    setPanel(&_panel_instance);
  }
};

LGFX lcd;

// --- PIN HARDWARE ---
#define PIN_MCP_CS     5
#define PIN_BUZZER     32
#define PIN_OIL_IND    34  // Switch to Ground
#define PIN_AKI_IND    35  // Switch to Ground

// --- KONFIGURASI SISTEM ---
#define ECU_ADDR       0x7E0
#define ECU_RESP       0x7E8
#define PID_DELAY      60   // Polling delay sangat cepat
#define MAX_RPM        8000
#define CAN_TIMEOUT    2000 // Watchdog koneksi
#define REQ_TIMEOUT    200  // Timeout request (CEPAT)

// Safety Thresholds
#define TEMP_WARN      100.0
#define TEMP_CRIT      110.0
#define VOLT_WARN      12.0
#define VOLT_CRIT      11.5
#define RPM_OIL_CHECK  1500 // RPM dimana oli wajib ON (High RPM)

// Init MCP_CAN
MCP_CAN CAN0(PIN_MCP_CS);

// --- VARIABEL ATOMIC (SHARED MEMORY) ---
std::atomic<float> targetRPM(0);
std::atomic<float> targetTemp(-40.0);
std::atomic<bool> checkEngineOn(false);
std::atomic<bool> pid42Supported(true);
std::atomic<bool> canConnected(false);
std::atomic<bool> oilIndBad(false);
std::atomic<bool> akiIndBad(false);
std::atomic<float> ecuVoltageAtomic(12.0);

// Safety States
enum SafetyState { SAFETY_OK, SAFETY_WARN, SAFETY_CRIT };
std::atomic<int> safetyLevel(SAFETY_OK);
std::atomic<int> buzzerMode(0); // 0:Off, 1:Single, 2:Double, 3:Alarm
char safetyMessage[64] = "SYSTEM OK";

// Variabel internal Core 1 (UI Only)
float currentRPM = 0;     
float currentTemp = -40.0; 
float rawVolt = 12.0;
float ecuVoltage = 12.0;
int prevRPM = 0;

// --- VARIABEL GLOBAL (Core 0 Logic) ---
unsigned long lastRxTime = 0;

enum CanState {
  CAN_IDLE,
  CAN_WAITING_RPM,
  CAN_WAITING_TEMP,
  CAN_WAITING_VOLT,
  CAN_WAITING_STATUS
};
CanState canState = CAN_IDLE;
unsigned long lastRequestTime = 0;
bool canBusy = false;
byte retryCount = 0;

// ISO-TP & DTC
char dtcResult[64] = "System Ready";
bool isParsingDTC = false;
byte dtcBuffer[128];
int dtcBufferIndex = 0;
byte expectedFrame = 0x21;
int dtcTotalLength = 0;

// UI State
bool displayMode = 0; // 0: Dashboard, 1: DTC
unsigned long lastDrawTime = 0;
unsigned long lastTouchTime = 0;
uint16_t touch_x, touch_y;

// Buzzer Logic State
unsigned long buzzerTime = 0;
bool buzzerStateHigh = false;
int buzzerStep = 0;

// --- SETUP ---
void setupBuzzer() {
  ledcAttachChannel(PIN_BUZZER, 2000, 8, 0);
  ledcWrite(0, 0);
}

void setup() {
  Serial.begin(115200);
  
  pinMode(PIN_OIL_IND, INPUT_PULLUP);
  pinMode(PIN_AKI_IND, INPUT_PULLUP);
  
  setupBuzzer();

  lcd.init();
  lcd.setRotation(1);
  lcd.setBrightness(255);

  // Startup Animation
  lcd.fillScreen(TFT_BLACK);
  lcd.setFont(&fonts::Font7);
  lcd.setTextDatum(middle_center);
  lcd.setTextColor(TFT_BLUE, TFT_BLACK);
  lcd.drawString("HAKATECH V6", 400, 240);
  delay(1000);
  lcd.fillScreen(TFT_BLACK);

  // Init CAN
  bool canOk = false;
  if (CAN0.begin(MCP_STD, CAN_500KBPS, MCP_8MHZ) == CAN_OK) canOk = true;
  else if (CAN0.begin(MCP_STD, CAN_500KBPS, MCP_16MHZ) == CAN_OK) canOk = true;

  if(canOk) {
    CAN0.init_Mask(0, 0, 0x7F0); 
    CAN0.init_Filt(0, 0, 0x7E8); 

    drawDashboardBackground(); 
    performNeedleSweep();
  } else {
    lcd.setTextColor(TFT_RED, TFT_BLACK);
    lcd.drawString("CAN ERROR", 400, 240);
    while(1);
  }

  // CREATE TASKS
  xTaskCreatePinnedToCore(taskCAN, "TaskCAN", 8192, NULL, 1, NULL, 0); 
  xTaskCreatePinnedToCore(taskUI,   "TaskUI",   4096, NULL, 2, NULL, 1); 
}

void loop() {
  vTaskDelay(1000 / portTICK_PERIOD_MS);
}

// -----------------------------------------------------------
// TASK 1: CORE 0 (LOGIC & CAN & SAFETY & BUZZER)
// -----------------------------------------------------------
void taskCAN(void *pvParameters) {
  unsigned long currentMillis;
  unsigned long engineOffTime = millis();
  
  while(1) {
    currentMillis = millis();

    // --- 1. BUZZER MANAGER ADVANCED ---
    handleBuzzer(currentMillis);

    // --- 2. Baca Input Fisik (Active LOW) ---
    bool oilPinLow = (digitalRead(PIN_OIL_IND) == LOW);
    bool akiPinLow = (digitalRead(PIN_AKI_IND) == LOW);
    
    oilIndBad.store(oilPinLow);
    akiIndBad.store(akiPinLow);

    // --- 3. SAFETY ENGINE LOGIC ---
    float tRPM = targetRPM.load();
    float tTemp = targetTemp.load();
    float tVolt = ecuVoltageAtomic.load();
    
    // Engine Off Detection
    if (tRPM > 500) {
      engineOffTime = currentMillis; 
    }
    bool isEngineOff = (currentMillis - engineOffTime > 3000) && (tRPM < 100);

    strcpy(safetyMessage, "SYSTEM OK");
    int newSafetyLevel = SAFETY_OK;
    int newBuzzerMode = 0;
    
    // Priority Check
    if (tTemp > TEMP_CRIT) {
      strcpy(safetyMessage, "OVERHEAT!!!");
      newSafetyLevel = SAFETY_CRIT;
      newBuzzerMode = 3; 
    }
    else if (oilPinLow && tRPM > RPM_OIL_CHECK) {
      strcpy(safetyMessage, "OIL PRESS LOW!");
      newSafetyLevel = SAFETY_CRIT;
      newBuzzerMode = 3;
    }
    else if (tVolt < VOLT_CRIT && isEngineOff == false) {
      strcpy(safetyMessage, "LOW VOLTAGE");
      newSafetyLevel = SAFETY_WARN;
      newBuzzerMode = 2; 
    }
    else if (akiPinLow) {
      strcpy(safetyMessage, "BAT WARNING");
      newSafetyLevel = SAFETY_WARN;
      newBuzzerMode = 2; 
    }
    else if (checkEngineOn.load()) {
      strcpy(safetyMessage, "CHECK ENGINE");
      newSafetyLevel = SAFETY_WARN;
    }
    else if (isEngineOff) {
      strcpy(safetyMessage, "ENGINE STOP");
      newSafetyLevel = SAFETY_OK;
      newBuzzerMode = 0;
    }

    safetyLevel.store(newSafetyLevel);
    if(newBuzzerMode != 0) buzzerMode.store(newBuzzerMode); 

    // --- 4. CAN WATCHDOG ---
    if (currentMillis - lastRxTime > CAN_TIMEOUT) {
      targetRPM.store(0); 
      canConnected.store(false);
      if(!canBusy) canState = CAN_IDLE; 
    } else {
      canConnected.store(true);
    }

    // --- 5. READ CAN & PROCESS ---
    unsigned long rxId;
    unsigned char len = 0;
    unsigned char rxBuf[8];
    while (CAN0.checkReceive() == CAN_MSGAVAIL) {
      CAN0.readMsgBuf(&rxId, &len, rxBuf);
      processCanFrame(rxId, len, rxBuf); 
    }

    // --- 6. OBD POLLING STATE MACHINE (FAST) ---
    if (displayMode == 0) { 
      if (!canBusy) {
        if (canState == CAN_IDLE && (currentMillis - lastRequestTime > PID_DELAY)) {
          requestOBD(0x01, 0x0C); 
          canState = CAN_WAITING_RPM;
          canBusy = true;
          retryCount = 0;
          lastRequestTime = currentMillis;
        }
      } 
      else if (canBusy && (currentMillis - lastRequestTime > REQ_TIMEOUT)) { 
        retryCount++;
        if (retryCount > 3) { 
          if (canState == CAN_WAITING_VOLT && pid42Supported.load()) {
            pid42Supported.store(false);
            requestOBD(0x01, 0x01);
            canState = CAN_WAITING_STATUS;
          } else {
            canState = CAN_IDLE;
            canBusy = false;
          }
          retryCount = 0;
          lastRequestTime = currentMillis;
        } else {
          lastRequestTime = currentMillis;
          if (canState == CAN_WAITING_RPM) requestOBD(0x01, 0x0C);
          else if (canState == CAN_WAITING_TEMP) requestOBD(0x01, 0x05);
          else if (canState == CAN_WAITING_VOLT && pid42Supported.load()) requestOBD(0x01, 0x42);
          else if (canState == CAN_WAITING_STATUS) requestOBD(0x01, 0x01);
        }
      }
    }
    vTaskDelay(1 / portTICK_PERIOD_MS);
  }
}

void handleBuzzer(unsigned long currentMillis) {
  int mode = buzzerMode.load();
  
  if (mode == 0) { 
    if (buzzerStateHigh) {
      ledcWrite(0, 0);
      buzzerStateHigh = false;
    }
    return;
  }

  switch (mode) {
    case 1: 
      if (buzzerStep == 0) {
        buzzerTime = currentMillis;
        ledcWrite(0, 128);
        buzzerStateHigh = true;
        buzzerStep = 1;
      } else if (buzzerStep == 1 && currentMillis - buzzerTime > 100) {
        ledcWrite(0, 0);
        buzzerStateHigh = false;
        buzzerStep = 2;
        buzzerMode.store(0); 
      }
      break;

    case 2: 
      if (buzzerStep == 0) {
        buzzerTime = currentMillis;
        ledcWrite(0, 128);
        buzzerStateHigh = true;
        buzzerStep = 1;
      } else if (buzzerStep == 1 && currentMillis - buzzerTime > 100) {
        ledcWrite(0, 0);
        buzzerStateHigh = false;
        buzzerTime = currentMillis;
        buzzerStep = 2;
      } else if (buzzerStep == 2 && currentMillis - buzzerTime > 100) {
        ledcWrite(0, 128);
        buzzerStateHigh = true;
        buzzerTime = currentMillis;
        buzzerStep = 3;
      } else if (buzzerStep == 3 && currentMillis - buzzerTime > 100) {
        ledcWrite(0, 0);
        buzzerStateHigh = false;
        buzzerStep = 4;
        buzzerMode.store(0);
      }
      break;

    case 3: 
      if (buzzerStep == 0) {
        buzzerTime = currentMillis;
        buzzerStep = 1;
      }
      long phase = (currentMillis - buzzerTime) % 1000;
      if (phase < 500) {
        if (!buzzerStateHigh) { ledcWrite(0, 128); buzzerStateHigh = true; }
      } else {
        if (buzzerStateHigh) { ledcWrite(0, 0); buzzerStateHigh = false; }
      }
      break;
  }
}

// -----------------------------------------------------------
// TASK 2: CORE 1 (UI & GRAPHICS)
// -----------------------------------------------------------
void taskUI(void *pvParameters) {
  unsigned long currentMillis;
  while(1) {
    currentMillis = millis();

    if (lcd.getTouch(&touch_x, &touch_y)) {
      if (currentMillis - lastTouchTime > 500) {
        lastTouchTime = currentMillis;
        handleTouch(touch_x, touch_y);
      }
    }

    if (currentMillis - lastDrawTime > 30) { 
      lastDrawTime = currentMillis;
      if (displayMode == 0) updateDashboard();
      else updateDTCScreen();
    }
    vTaskDelay(1 / portTICK_PERIOD_MS);
  }
}

// --- LOGIKA CAN (Core 0) ---
void requestOBD(byte mode, byte pid) {
  unsigned char len = 8;
  unsigned char buf[8] = {0};
  buf[0] = 0x02; buf[1] = mode; buf[2] = pid;
  CAN0.sendMsgBuf(ECU_ADDR, 0, len, buf);
}

void requestDTC() {
  strcpy(dtcResult, "Reading...");
  requestOBD(0x03, 0x00);
  canBusy = true;
  lastRequestTime = millis();
  isParsingDTC = false;
  retryCount = 0;
}

void sendFlowControl(uint16_t rxId) {
  uint16_t txId = rxId - 8;
  unsigned char len = 8;
  unsigned char buf[8] = {0x30, 0x00, 0x00};
  CAN0.sendMsgBuf(txId, 0, len, buf);
}

void processCanFrame(unsigned long id, unsigned char len, unsigned char buf[]) {
  if (id < 0x7E8 || id > 0x7EF) return;
  byte pciType = buf[0] & 0xF0;
  byte mode = buf[1];

  if (buf[1] == 0x7F) {
    if(buf[3] == 0x42) {
      pid42Supported.store(false);
      requestOBD(0x01, 0x01);
      canState = CAN_WAITING_STATUS;
      return;
    }
    canState = CAN_IDLE;
    canBusy = false;
    return;
  }

  if (mode == 0x43 || isParsingDTC) {
    lastRxTime = millis();
    
    if (pciType == 0x10) { 
      isParsingDTC = true;
      dtcBufferIndex = 0;
      expectedFrame = 0x21;
      dtcTotalLength = ((buf[0] & 0x0F) << 8) | buf[1];
      for (int i = 2; i < len; i++) {
        if(dtcBufferIndex < sizeof(dtcBuffer)) dtcBuffer[dtcBufferIndex++] = buf[i];
      }
      sendFlowControl(id);
    } 
    else if (pciType == 0x00) { 
      dtcTotalLength = buf[0] & 0x0F;
      dtcBufferIndex = 0;
      for (int i = 2; i < len && dtcBufferIndex < dtcTotalLength; i++) {
        if(dtcBufferIndex < sizeof(dtcBuffer)) dtcBuffer[dtcBufferIndex++] = buf[i];
      }
      parseDTCData();
      isParsingDTC = false;
      canState = CAN_IDLE;
      canBusy = false;
    }
    else if (pciType == 0x20) { 
      byte seq = buf[0] & 0x0F;
      if (seq == expectedFrame) {
        for (int i = 1; i < len; i++) {
          if (dtcBufferIndex < sizeof(dtcBuffer)) dtcBuffer[dtcBufferIndex++] = buf[i];
        }
        expectedFrame++;
      }
      if (dtcBufferIndex >= dtcTotalLength || dtcBufferIndex >= sizeof(dtcBuffer)) {
        parseDTCData();
        isParsingDTC = false;
        canState = CAN_IDLE;
        canBusy = false;
      }
    }
    return;
  }

  if (canBusy && mode == 0x41) {
    lastRxTime = millis(); 

    if (canState == CAN_WAITING_RPM && buf[2] == 0x0C) { 
      targetRPM.store(((buf[3] << 8) | buf[4]) / 4);
      retryCount = 0;
      requestOBD(0x01, 0x05); 
      canState = CAN_WAITING_TEMP;
      lastRequestTime = millis();
    } 
    else if (canState == CAN_WAITING_TEMP && buf[2] == 0x05) { 
      targetTemp.store(buf[3] - 40.0);
      retryCount = 0;
      if(pid42Supported.load()) {
        requestOBD(0x01, 0x42); 
        canState = CAN_WAITING_VOLT;
      } else {
        requestOBD(0x01, 0x01); 
        canState = CAN_WAITING_STATUS;
      }
      lastRequestTime = millis();
    }
    else if (canState == CAN_WAITING_VOLT && buf[2] == 0x42) { 
      rawVolt = ((buf[3] * 256) + buf[4]) / 1000.0;
      ecuVoltage = (ecuVoltage * 0.95) + (rawVolt * 0.05); 
      ecuVoltageAtomic.store(ecuVoltage);
      retryCount = 0;
      requestOBD(0x01, 0x01); 
      canState = CAN_WAITING_STATUS;
      lastRequestTime = millis();
    }
    else if (canState == CAN_WAITING_STATUS && buf[2] == 0x01) { 
      bool mil = (buf[3] & 0x80);
      if (mil != checkEngineOn.load()) {
        checkEngineOn.store(mil);
        if (mil) {
           buzzerMode.store(1);
        }
      }
      retryCount = 0;
      canState = CAN_IDLE;
      canBusy = false;
    }
  }
}

void parseDTCData() {
  char res[128] = "";
  bool hasError = false;
  for (int i = 1; i < dtcBufferIndex - 1; i += 2) {
    byte b1 = dtcBuffer[i], b2 = dtcBuffer[i+1];
    if (b1 == 0 && b2 == 0) break;
    hasError = true;
    char type = 'P';
    switch ((b1 >> 6) & 0x03) { 
      case 1: type = 'C'; break; case 2: type = 'B'; break; case 3: type = 'U'; break;
    }
    int code = ((b1 & 0x3F) << 8) | b2;
    char bufCode[10];
    sprintf(bufCode, "%c%04X ", type, code);
    if (strlen(res) + strlen(bufCode) < sizeof(res)) strcat(res, bufCode);
  }
  if (!hasError) strcpy(res, "SYSTEM OK");
  else strcpy(dtcResult, res);
}

// --- FUNGSI GRAFIS (CORE 1) ---

void drawDashboardBackground() {
  lcd.fillScreen(TFT_BLACK);
  int cx = 400; int cy = 240; int r = 180;

  for (int i = 135; i <= 405; i+=2) {
    float rad = i * 0.0174532925;
    uint16_t color = TFT_BLUE;
    if (i > 270 && i <= 315) color = TFT_YELLOW;
    if (i > 315) color = TFT_RED; 
    float x1 = cx + (r-10) * cos(rad);
    float y1 = cy + (r-10) * sin(rad);
    float x2 = cx + r * cos(rad);
    float y2 = cy + r * sin(rad);
    lcd.drawLine(x1, y1, x2, y2, color);
  }

  for (int i = 135; i <= 405; i+=15) {
    float rad = i * 0.0174532925;
    float x1 = cx + (r-40) * cos(rad);
    float y1 = cy + (r-40) * sin(rad);
    float x2 = cx + r * cos(rad);
    float y2 = cy + r * sin(rad);
    lcd.drawLine(x1, y1, x2, y2, TFT_WHITE);
  }

  lcd.setFont(&fonts::Font0);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setTextDatum(middle_center);
  
  int angles[] = {135, 180, 225, 270, 315, 405};
  const char* nums[] = {"0", "2", "4", "6", "8", ""};
  
  for(int i=0; i<6; i++) {
    float rad = angles[i] * 0.0174532925;
    lcd.drawString(nums[i], cx + (r-35)*cos(rad), cy + (r-35)*sin(rad));
  }

  lcd.setFont(&fonts::Font2);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.setTextDatum(top_left);
  lcd.drawString("ECU VOLT:", 50, 50);
  lcd.setTextDatum(top_right);
  lcd.drawString("STATUS:", 750, 50);
  lcd.setTextDatum(bottom_left);
  lcd.drawString("OIL:", 50, 430);
  lcd.setTextDatum(bottom_right);
  lcd.drawString("TEMP:", 750, 430);
  
  lcd.drawCircle(120, 400, 15, TFT_RED);
  lcd.drawCircle(680, 80, 15, TFT_RED);
  
  lcd.setFont(&fonts::Font4);
  lcd.setTextDatum(middle_center);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("HAKATECH", 400, 380);
  
  lcd.setFont(&fonts::Font0);
  lcd.setTextDatum(top_center);
  lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  lcd.drawString("ENGINE RPM", 400, 100);
}

void performNeedleSweep() {
  int cx = 400; int cy = 240; int r = 155; 
  
  for (int rpm = 0; rpm <= MAX_RPM; rpm+=100) {
    if (rpm > 0) {
        float prevAngle = 135.0 + ((rpm - 100) / (float)MAX_RPM) * 270.0;
        float radPrev = prevAngle * 0.0174532925;
        int px = cx + (r * cos(radPrev));
        int py = cy + (r * sin(radPrev));
        lcd.fillTriangle(cx, cy, px-3, py, px+3, py, TFT_BLACK);
    }

    float angle = 135.0 + (rpm / (float)MAX_RPM) * 270.0;
    float rad = angle * 0.0174532925;
    int x = cx + (r * cos(rad));
    int y = cy + (r * sin(rad));
    lcd.fillTriangle(cx, cy, x-3, y, x+3, y, TFT_ORANGE); 
    lcd.fillCircle(cx, cy, 12, TFT_WHITE);
    delay(3);
  }
  
  delay(200);

  for (int rpm = MAX_RPM; rpm >= 0; rpm-=100) {
    float prevAng = 135.0 + ((rpm + 100) / (float)MAX_RPM) * 270.0;
    float radPrev = prevAng * 0.0174532925;
    int px = cx + (r * cos(radPrev));
    int py = cy + (r * sin(radPrev));
    lcd.fillTriangle(cx, cy, px-3, py, px+3, py, TFT_BLACK);
    
    if(rpm > 0) {
      float angle = 135.0 + (rpm / (float)MAX_RPM) * 270.0;
      float rad = angle * 0.0174532925;
      int x = cx + (r * cos(rad));
      int y = cy + (r * sin(rad));
      lcd.fillTriangle(cx, cy, x-3, y, x+3, y, TFT_ORANGE); 
      lcd.fillCircle(cx, cy, 12, TFT_WHITE);
    } else {
       lcd.fillCircle(cx, cy, 12, TFT_WHITE);
    }
    delay(3);
  }
}

void updateDashboard() {
  // FIX SCOPE: Declare local variable for time
  unsigned long t = millis();

  float tRPM = targetRPM.load();
  float tTemp = targetTemp.load();
  float tVolt = ecuVoltageAtomic.load();
  int sLevel = safetyLevel.load();
  
  float lerpSpeed = 0.15;
  currentRPM = currentRPM + (tRPM - currentRPM) * lerpSpeed;
  currentTemp = currentTemp + (tTemp - currentTemp) * 0.05;

  int cx = 400; int cy = 240; int r = 155;

  // Hapus Jarum Lama
  float prevAngle = 135.0 + (prevRPM / (float)MAX_RPM) * 270.0;
  float radPrev = prevAngle * 0.0174532925;
  int px = cx + (r * cos(radPrev));
  int py = cy + (r * sin(radPrev));
  lcd.fillTriangle(cx, cy, px-6, py, px+6, py, TFT_BLACK);

  // Gambar Jarum Baru
  float angle = 135.0 + (currentRPM / (float)MAX_RPM) * 270.0;
  float rad = angle * 0.0174532925;
  int x = cx + (r * cos(rad));
  int y = cy + (r * sin(rad));
  
  uint16_t needleColor = TFT_ORANGE;
  if (currentRPM > 6000 || sLevel == SAFETY_CRIT) needleColor = TFT_RED;
  
  lcd.fillTriangle(cx, cy, x-3, y, x+3, y, needleColor);
  lcd.fillCircle(cx, cy, 12, TFT_WHITE);
  prevRPM = currentRPM;

  lcd.setFont(&fonts::Font8);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.setTextDatum(bottom_center);
  char buf[10];
  sprintf(buf, "%d", (int)currentRPM);
  lcd.drawString(buf, cx, 300);

  // --- SAFETY MESSAGE AREA (Center Bottom) ---
  lcd.setTextPadding(700); 
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  if (sLevel == SAFETY_CRIT) {
     // FIX COLOR & SCOPE: Use local 't' and TFT_MAROON
     if (t % 500 < 250) lcd.setTextColor(TFT_RED, TFT_BLACK);
     else lcd.setTextColor(TFT_MAROON, TFT_BLACK); 
     lcd.setFont(&fonts::Font4);
     lcd.setTextDatum(middle_center);
     lcd.drawString(safetyMessage, 400, 340);
  } else if (sLevel == SAFETY_WARN) {
     lcd.setTextColor(TFT_YELLOW, TFT_BLACK);
     lcd.setFont(&fonts::Font4);
     lcd.setTextDatum(middle_center);
     lcd.drawString(safetyMessage, 400, 340);
  }

  // Data 4 Sudut
  lcd.setFont(&fonts::Font2);

  // VOLT
  lcd.setTextDatum(top_left);
  lcd.setTextPadding(100);
  char vbuf[10];
  sprintf(vbuf, "%.1fV", tVolt);
  if (tVolt < VOLT_WARN) lcd.setTextColor(TFT_RED, TFT_BLACK);
  else if (tVolt < 13.5) lcd.setTextColor(TFT_YELLOW, TFT_BLACK);
  else lcd.setTextColor(TFT_GREEN, TFT_BLACK);
  lcd.drawString(vbuf, 50, 90);

  // IND AKI
  if(akiIndBad.load()) {
    lcd.fillCircle(680, 80, 12, TFT_RED);
    lcd.setFont(&fonts::Font0);
    lcd.setTextColor(TFT_BLACK, TFT_RED);
    lcd.setTextDatum(middle_center);
    lcd.drawString("BAT", 680, 80);
  } else {
    lcd.fillCircle(680, 80, 12, TFT_BLACK);
  }

  // STATUS (MIL)
  lcd.setTextDatum(top_right);
  lcd.setTextPadding(100);
  if (checkEngineOn.load()) {
    // FIX SCOPE: Use local 't'
    if (t % 1000 < 500) {
      lcd.setTextColor(TFT_RED, TFT_BLACK);
      lcd.drawString("MIL ON", 750, 90);
    } else {
      lcd.drawString("      ", 750, 90);
    }
  } else {
    lcd.setTextColor(TFT_GREEN, TFT_BLACK);
    lcd.drawString("OK", 750, 90);
  }

  // OIL Text
  lcd.setTextDatum(bottom_left);
  lcd.setTextPadding(100);
  if (oilIndBad.load()) {
    lcd.setTextColor(TFT_RED, TFT_BLACK);
    lcd.drawString("LOW", 50, 430);
  } else {
    lcd.setTextColor(TFT_GREEN, TFT_BLACK);
    lcd.drawString("OK", 50, 430);
  }

  // IND OIL Icon
  if(oilIndBad.load()) {
    lcd.fillCircle(120, 400, 12, TFT_RED);
    lcd.setFont(&fonts::Font0);
    lcd.setTextColor(TFT_BLACK, TFT_RED);
    lcd.setTextDatum(middle_center);
    lcd.drawString("!", 120, 400);
  } else {
    lcd.fillCircle(120, 400, 12, TFT_BLACK);
  }

  // TEMP
  lcd.setTextDatum(bottom_right);
  lcd.setTextPadding(100);
  char tbuf[10];
  if (currentTemp > -30) {
    sprintf(tbuf, "%.0f°C", currentTemp);
    uint16_t tempColor = TFT_BLUE;
    if (currentTemp >= TEMP_WARN && currentTemp < TEMP_CRIT) tempColor = TFT_GREEN;
    if (currentTemp >= TEMP_CRIT) tempColor = TFT_RED;
    lcd.setTextColor(tempColor, TFT_BLACK);
  } else {
    sprintf(tbuf, "--°C");
    lcd.setTextColor(TFT_DARKGREY, TFT_BLACK);
  }
  lcd.drawString(tbuf, 750, 430);
}

// --- MENU DTC ---
void drawDTCScreen() {
  lcd.fillScreen(TFT_BLACK);
  lcd.setTextColor(TFT_BLUE, TFT_BLACK);
  lcd.setFont(&fonts::Font4);
  lcd.setTextDatum(top_center);
  lcd.drawString("DIAGNOSTIC MODE", 400, 50);
  
  lcd.drawRect(50, 100, 700, 200, TFT_WHITE);
  
  lcd.fillRoundRect(300, 350, 200, 60, 10, TFT_RED);
  lcd.setTextColor(TFT_WHITE, TFT_RED);
  lcd.setFont(&fonts::Font2);
  lcd.setTextDatum(middle_center);
  lcd.drawString("BACK", 400, 380);
  
  lcd.fillRoundRect(300, 280, 200, 60, 10, TFT_YELLOW);
  lcd.setTextColor(TFT_BLACK, TFT_YELLOW);
  lcd.drawString("READ DTC", 400, 310);
  
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
}

void updateDTCScreen() {
  lcd.setFont(&fonts::Font4);
  lcd.setTextDatum(middle_center);
  lcd.setTextPadding(700);
  lcd.setTextColor(TFT_WHITE, TFT_BLACK);
  lcd.drawString(dtcResult, 400, 200);
}

void handleTouch(uint16_t tx, uint16_t ty) {
  if (displayMode == 0) {
    if (tx > 250 && tx < 550 && ty > 280 && ty < 380) {
      displayMode = 1;
      drawDTCScreen();
      canState = CAN_IDLE;
      canBusy = false;
    }
  } else {
    if (tx > 300 && tx < 500 && ty > 350 && ty < 410) {
      displayMode = 0;
      drawDashboardBackground();
      canState = CAN_IDLE;
      canBusy = false;
    }
    else if (tx > 300 && tx < 500 && ty > 280 && ty < 340) {
      requestDTC();
    }
  }
}