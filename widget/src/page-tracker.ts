// Merkt paginawissels op. Single-page apps wisselen van URL zonder te herladen, dus
// naast popstate/hashchange kijken we elke seconde of location.href veranderd is.
// history.pushState patchen zou preciezer zijn, maar dat is ingrijpen in de app die
// ons insluit. Dit loopt ook buiten een opname: een wissel van vlak vóór Opnemen gaat
// via de buffer mee. Wat er van het adres bewaard blijft, beslist de widget.

const POLL_MS = 1_000;

export class PageTracker {
  private last = '';
  private timer = 0;
  private readonly check = () => this.sample();
  private readonly onChange: (href: string, title: string) => void;

  constructor(onChange: (href: string, title: string) => void) {
    this.onChange = onChange;
  }

  start(): void {
    this.last = location.href;
    window.addEventListener('popstate', this.check);
    window.addEventListener('hashchange', this.check);
    this.timer = window.setInterval(this.check, POLL_MS);
  }

  stop(): void {
    window.removeEventListener('popstate', this.check);
    window.removeEventListener('hashchange', this.check);
    window.clearInterval(this.timer);
  }

  private sample(): void {
    const href = location.href;
    if (href === this.last) return;
    this.last = href;
    this.onChange(href, document.title);
  }
}
