// Runtime settings for the SDP dashboard container, mounted over
// /usr/share/nginx/html/settings/env-config.js. Same keys as
// dev/env-config-testnet.js at tag 7.0.0.
window._env_ = {
  API_URL: "http://localhost:8000",
  STELLAR_EXPERT_URL: "https://stellar.expert/explorer/testnet",
  HORIZON_URL: "https://horizon-testnet.stellar.org",
  RPC_ENABLED: true,
  RECAPTCHA_SITE_KEY: "",
  SINGLE_TENANT_MODE: false
};
