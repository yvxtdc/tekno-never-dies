(function () {
  var tabs = [
    ["tab-mentions", "panel-mentions"],
    ["tab-rgpd", "panel-rgpd"],
    ["tab-cgl", "panel-cgl"],
  ].map(function (pair) {
    return { tab: document.getElementById(pair[0]), panel: document.getElementById(pair[1]) };
  });

  tabs.forEach(function (t) {
    t.tab.addEventListener("click", function () {
      tabs.forEach(function (o) {
        var active = o === t;
        o.tab.setAttribute("aria-selected", String(active));
        o.panel.hidden = !active;
      });
    });
  });
})();
