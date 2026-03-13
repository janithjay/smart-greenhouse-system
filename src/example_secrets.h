#include <pgmspace.h>

#define SECRET

// === WiFi Configuration ===
// (If you use WiFiManager, it will overwrite this, but it's safe to keep)
const char WIFI_SSID[] = "Your_WiFi_Name";
const char WIFI_PASSWORD[] = "Your_WiFi_Password";

// === AWS IoT Endpoint ===
// You found this earlier in the IoT Core Settings! 
// E.g., "xxxxxxxxxxxxxx-ats.iot.us-east-1.amazonaws.com"
const char AWS_IOT_ENDPOINT[] = "PASTE_YOUR_AWS_ENDPOINT_HERE";

// === Device Certificate ===
// Copy the contents of the xxxxxx-certificate.pem.crt file here.
static const char AWS_CERT_CRT[] PROGMEM = R"KEY(
-----BEGIN CERTIFICATE-----
PASTE_YOUR_DEVICE_CERTIFICATE_HERE
-----END CERTIFICATE-----
)KEY";

// === Device Private Key ===
// Copy the contents of the xxxxxx-private.pem.key file here.
static const char AWS_CERT_PRIVATE[] PROGMEM = R"KEY(
-----BEGIN RSA PRIVATE KEY-----
PASTE_YOUR_PRIVATE_KEY_HERE
-----END RSA PRIVATE KEY-----
)KEY";

// === Amazon Root CA 1 ===
// Copy the contents of the AmazonRootCA1.pem file here.
static const char AWS_CERT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE_AMAZON_ROOT_CA_HERE
-----END CERTIFICATE-----
)EOF";