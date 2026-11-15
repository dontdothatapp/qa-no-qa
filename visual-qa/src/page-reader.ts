/**
 * In-page reader, passed to `frame.evaluate`. It must be fully self-contained
 * (no imports, no outer variables): Playwright serialises it with toString().
 *
 * Marks every visible interactive element with data-qa-ref="<n>" (clearing old
 * marks first, including inside open shadow roots) and returns their description.
 */
export type RawControl = {
  ref: number;
  role: string;
  name: string;
  inputType: string | null;
  value: string | null;
  state: string | null;
  context: string | null;
  inViewport: boolean;
  isPassword: boolean;
  /** A control that submits its form (submit input, or a button whose type is submit inside a form). */
  isSubmit: boolean;
  /** For fields inside a form: the label of the form's default submit control (what Enter would trigger). */
  formSubmitLabel: string | null;
};

export type RawPage = { url: string; title: string; text: string; controls: RawControl[] };

export function readPage(args: { startRef: number; maxTextChars: number }): RawPage {
  const SEL =
    'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],' +
    '[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[contenteditable=""],[contenteditable=true]';
  const CONTEXT_SEL = 'article,li,tr,[class*=card],[class*=product],[class*=item]';
  const clean = (s: string | null | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const labelText = (el: Element): string => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const root = el.getRootNode() as Document | ShadowRoot;
      const txt = by.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent ?? document.getElementById(id)?.textContent ?? '').join(' ');
      if (txt.trim()) return txt;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) return Array.from(labels).map((l) => l.textContent ?? '').join(' ');
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type;
      if (t === 'submit' || t === 'button' || t === 'reset') return (el as HTMLInputElement).value;
    }
    const ph = el.getAttribute('placeholder');
    if (ph) return ph;
    const text = (el as HTMLElement).innerText;
    if (text && text.trim()) return text;
    const img = el.querySelector('img[alt]');
    if (img) return img.getAttribute('alt') ?? '';
    return el.getAttribute('title') ?? el.getAttribute('name') ?? '';
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type;
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button' || t === 'reset' || t === 'image') return 'button';
      if (t === 'file') return 'file';
      return 'textbox';
    }
    return 'textbox'; // contenteditable
  };

  const controls: RawControl[] = [];
  let ref = args.startRef;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const visit = (root: Document | ShadowRoot | Element) => {
    for (const el of Array.from(root.children)) {
      el.removeAttribute('data-qa-ref');
      if (el.matches(SEL) && visible(el)) {
        const tag = el.tagName.toLowerCase();
        const input = el as HTMLInputElement;
        const isPassword = tag === 'input' && input.type === 'password';
        const inputType = tag === 'input' ? (input.type || 'text') : tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : null;
        let value: string | null = null;
        let state: string | null = null;
        if (tag === 'input' && (input.type === 'checkbox' || input.type === 'radio')) {
          state = input.checked ? 'checked' : 'unchecked';
        } else if (tag === 'select') {
          const sel = el as HTMLSelectElement;
          value = clean(sel.options[sel.selectedIndex]?.text, 60);
        } else if ((tag === 'input' && input.type !== 'file' && !isPassword) || tag === 'textarea') {
          value = clean(input.value, 60);
        } else if (tag === 'input' && input.type === 'file') {
          value = input.files && input.files.length ? clean(input.files[0].name, 60) : '';
        }
        if (el.hasAttribute('disabled')) state = state ? `${state}, disabled` : 'disabled';
        const expanded = el.getAttribute('aria-expanded');
        if (expanded) state = state ? `${state}, expanded=${expanded}` : `expanded=${expanded}`;
        const form = (el as HTMLInputElement).form ?? null;
        const isSubmit =
          (tag === 'input' && (input.type === 'submit' || input.type === 'image')) ||
          (tag === 'button' && (el as HTMLButtonElement).type === 'submit' && !!form);
        let formSubmitLabel: string | null = null;
        if (form && !isSubmit && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
          const sub = form.querySelector('button[type=submit], button:not([type]), input[type=submit], input[type=image]');
          if (sub) formSubmitLabel = clean(labelText(sub), 100) || 'Submit';
        }
        const holder = el.parentElement?.closest(CONTEXT_SEL);
        const r = el.getBoundingClientRect();
        el.setAttribute('data-qa-ref', String(ref));
        controls.push({
          ref,
          role: roleOf(el),
          name: clean(labelText(el), 100),
          inputType,
          value,
          state,
          context: holder ? clean((holder as HTMLElement).innerText, 80) : null,
          inViewport: r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw,
          isPassword,
          isSubmit,
          formSubmitLabel,
        });
        ref++;
      }
      if (el.shadowRoot) visit(el.shadowRoot);
      visit(el);
    }
  };
  visit(document);

  const text = (document.body?.innerText ?? '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, args.maxTextChars);
  return { url: location.href, title: document.title, text, controls };
}
