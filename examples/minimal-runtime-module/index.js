let host;

class GreetingPage extends HTMLElement {
  #unsubscribeSettings;
  #unsubscribeTheme;

  connectedCallback() {
    this.#unsubscribeSettings = host.settings.subscribe(() => this.render());
    this.#unsubscribeTheme = host.theme.subscribe(() => this.render());
    this.render();
  }

  disconnectedCallback() {
    this.#unsubscribeSettings?.();
    this.#unsubscribeTheme?.();
  }

  render() {
    const showDetails = host.settings.get("showDetails", true);
    const theme = host.theme.get();
    this.innerHTML = `
      <section style="border:1px solid var(--border);border-radius:0.75rem;background:var(--card);color:var(--card-foreground);padding:1.5rem">
        <h2 style="margin:0;font-size:1.125rem">运行时模块已连接</h2>
        <p style="color:var(--muted-foreground)">这个页面由 Web Component 提供，侧边栏与设置由清单注册。</p>
        ${showDetails ? `<code>example-greeting@${host.module.version} · ${theme.mode}/${theme.preset}</code>` : ""}
      </section>
    `;
  }
}

export async function activate(hostSdk) {
  host = hostSdk;
  if (!customElements.get("example-greeting-page")) {
    customElements.define("example-greeting-page", GreetingPage);
  }
  await host.logger.info("Example greeting module activated");
}

export async function deactivate() {
  await host?.logger.info("Example greeting module deactivated");
}
