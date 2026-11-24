// The landing: HUSH MONEY arrives alone, centred on the screen, each letter
// rising out of a mask. It holds a moment, then glides up to its place while
// the rest of the page rises in beneath it while the footer, which was showing behind
// the title, is pushed down off the screen. It always plays through: a click or
// key partway does nothing. Reduced motion skips the whole thing. It plays when someone arrives, or reloads:
// coming back from How it works or Good Music, the page is simply there.

const EXPO = 'cubic-bezier(0.23, 1, 0.32, 1)'; // the stylesheet's --ease-out
const GLIDE = 'cubic-bezier(0.65, 0, 0.35, 1)';
const LETTER_MS = 850;
const STAGGER_MS = 50;
const HOLD_MS = 450;
const GLIDE_MS = 1000;

// True when this visit came from another page of this site, by a link or the back button.
function cameFromInside(): boolean {
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (nav?.type === 'reload') return false;
  if (nav?.type === 'back_forward') return true;
  try {
    return new URL(document.referrer).origin === location.origin;
  } catch {
    return false; // no referrer: typed, bookmarked or opened from somewhere else
  }
}

export async function intro(root: HTMLElement) {
  const title = root.querySelector<HTMLElement>('.title')!;
  const reveal = [...root.querySelectorAll<HTMLElement>('.reveal')];
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || cameFromInside()) return;

  // Each letter sits in a mask of its own (made when the page starts), so it can rise out of nothing.
  const letters = [...title.querySelectorAll<HTMLElement>('.ch > span')];
  if (!letters.length) return;

  root.dataset.intro = 'pre';
  scrollTo(0, 0); // a hard refresh can restore a scrolled position; the landing always starts at the top
  const foot = root.querySelector<HTMLElement>('.sitefoot');
  document.documentElement.style.overflow = 'hidden';
  await document.fonts.ready;

  // Park the title in the middle of the screen: where it sits now, less the distance to the centre.
  const box = title.getBoundingClientRect();
  // Centred, unless that would touch the footer waiting behind it: then it sits a little above the checkerboard.
  const footTop = foot ? foot.getBoundingClientRect().top : innerHeight;
  const drop = Math.min(innerHeight / 2 - (box.top + box.height / 2), footTop - 28 - box.bottom);
  title.style.transform = `translateY(${drop}px)`;

  const running: Animation[] = [];
  const play = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const a = el.animate(frames, { fill: 'both', ...options });
    running.push(a);
    return a;
  };

  letters.forEach((l, i) =>
    play(l, [{ transform: 'translateY(112%)' }, { transform: 'none' }], { duration: LETTER_MS, delay: i * STAGGER_MS, easing: EXPO }),
  );
  title.style.visibility = 'visible'; // hidden by the stylesheet until the letters are in place
  const landed = letters.length * STAGGER_MS + LETTER_MS;
  const start = landed + HOLD_MS;
  play(title, [{ transform: `translateY(${drop}px)` }, { transform: 'translateY(0)' }], { duration: GLIDE_MS, delay: start, easing: GLIDE });
  // The footer waits at the bottom of the screen behind the title, then is pushed down and out as the title rises.
  if (foot) play(foot, [{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: GLIDE_MS, delay: start, easing: GLIDE });
  reveal.forEach((el, i) =>
    play(el, [{ opacity: 0, transform: 'translateY(28px)' }, { opacity: 1, transform: 'none' }], {
      duration: 800,
      delay: start + 350 + i * 110,
      easing: EXPO,
    }),
  );

  await Promise.all(running.map((a) => a.finished.catch(() => undefined)));
  for (const a of running) a.cancel();
  title.style.transform = '';
  title.style.visibility = '';
  delete root.dataset.intro;
  document.documentElement.style.overflow = '';
}
