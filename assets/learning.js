document.querySelectorAll("[data-reveal-button]").forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("aria-controls");
    const target = targetId ? document.getElementById(targetId) : null;

    if (!target) {
      return;
    }

    const shouldReveal = target.hasAttribute("hidden");
    target.toggleAttribute("hidden", !shouldReveal);
    button.setAttribute("aria-expanded", String(shouldReveal));
    button.textContent = shouldReveal ? "收起答案" : "检查答案";
  });
});
