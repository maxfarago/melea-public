(function () {
  "use strict";

  // derive the api origin from the ui host: strip a leading ops./app./www. and
  // prefix api. (melea.ai -> api.melea.ai, ops.melea.ai -> api.melea.ai,
  // app.dev.melea.ai -> api.dev.melea.ai). anything that isn't a melea.ai host
  // (localhost, cloudfront preview domains) stays same-origin (empty base).
  var host = (window.location.host || "").split(":")[0].toLowerCase();
  if (host === "melea.ai" || host.endsWith(".melea.ai")) {
    window.API_BASE = "https://api." + host.replace(/^(ops|app|www)\./, "");
  } else {
    window.API_BASE = "";
  }
})();
