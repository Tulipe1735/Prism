document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-target]");
  if (!control) return;
  event.preventDefault();
  const state = document.querySelector("#eval-state");
  if (control.hasAttribute("data-correct")) {
    state.dataset.correctActions = String(Number(state.dataset.correctActions) + 1);
    control.setAttribute("disabled", "");
    if (control.tagName === "A") control.setAttribute("aria-disabled", "true");
  } else {
    state.dataset.wrongTargets = String(Number(state.dataset.wrongTargets) + 1);
  }
  document.querySelector("#result").textContent =
    `Completed: ${control.dataset.description}`;
});
window.__prismEval = {
  mutate() {
    throw new Error("No confirmatory mutations");
  },
};
