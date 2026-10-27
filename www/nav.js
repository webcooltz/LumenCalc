// Hamburger menu and view switching. Add a view: a <main id="view-NAME"> plus an entry here and a drawer button.
(function () {
  const VIEWS = { calc: "Calculator", convert: "Unit Converter", code: "Code", settings: "Settings" };

  const drawer = document.getElementById("drawer");
  const menuBtn = document.getElementById("menu-btn");
  const title = document.getElementById("title");

  function setDrawer(open) {
    drawer.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
  }

  function show(name) {
    if (!VIEWS[name]) name = "calc";
    Object.keys(VIEWS).forEach((v) => {
      document.getElementById("view-" + v).hidden = v !== name;
    });
    drawer.querySelectorAll("[data-view]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === name)
    );
    title.textContent = VIEWS[name];
    store("view", name);
    setDrawer(false);
    document.dispatchEvent(new CustomEvent("viewchange", { detail: name }));
  }

  menuBtn.addEventListener("click", () => setDrawer(drawer.hidden));
  drawer.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) show(b.dataset.view);
    else if (e.target.closest("[data-close]")) setDrawer(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.hidden) setDrawer(false);
  });

  show(store("view") || "calc");
})();
