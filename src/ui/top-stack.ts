/**
 * 연결 안내 띠를 위쪽 병동 표시와 설정 단추 바로 아래에 둬요.
 * 병동 표시는 집계가 붙거나 글자를 크게 하면 높이가 바뀌어서, 크기가 바뀔 때마다 다시 재요.
 * 안내 띠가 떠 있는 동안에는 그 높이만큼 위쪽 알림(#notice, #left-cards)을 아래로 내려 겹치지 않게 해요.
 */
export function followTopStack(banner: HTMLElement): void {
  const root = document.documentElement;
  const hud = document.getElementById("hud");
  const settings = document.getElementById("settings");
  const GAP = 8;

  const measure = (): void => {
    let bottom = 0;
    for (const element of [hud, settings?.querySelector<HTMLElement>(".settings-toggle") ?? null]) {
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.max(bottom, rect.bottom);
    }
    root.style.setProperty("--top-stack-bottom", `${Math.round(bottom)}px`);
    const shown = !banner.hidden && banner.getBoundingClientRect().height > 0;
    root.style.setProperty("--banner-space", shown ? `${Math.round(banner.getBoundingClientRect().height + GAP)}px` : "0px");
  };

  measure();
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(measure);
    for (const element of [hud, settings, banner]) if (element) observer.observe(element);
  }
  // hidden이 바뀌는 것은 크기 관찰로 잡히지 않을 때가 있어서 속성 변화도 봐요.
  const watch = new MutationObserver(measure);
  for (const element of [hud, settings, banner]) if (element) watch.observe(element, { attributes: true, attributeFilter: ["hidden"], subtree: element === settings });
  window.addEventListener("resize", measure);
}
