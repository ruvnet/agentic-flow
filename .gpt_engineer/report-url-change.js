export const loadReportUrlChangeEventListener = () => {
  /**
   * Listen to URL changes and report them to the parent window
   *
   * See https://stackoverflow.com/a/46428962
   * The Navigation API https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API seemed promising,
   * but it is not supported in all major browsers.
   */
  const observeUrlChange = () => {
    let oldHref = document.location.href;
    const body = document.querySelector("body");
    const observer = new MutationObserver(() => {
      if (oldHref !== document.location.href) {
        oldHref = document.location.href;
        window.top.postMessage({ type: "URL_CHANGED", url: document.location.href }, "https://run.gptengineer.app");
        window.top.postMessage({ type: "URL_CHANGED", url: document.location.href }, "http://localhost:3000");
      }
    });
    observer.observe(body, { childList: true, subtree: true });
  };

  window.addEventListener("load", observeUrlChange);
};