import { loadGetUserSnapshotEventListener } from "./get-user-snapshot";
import { loadReportUrlChangeEventListener } from "./report-url-change";
import { loadReportErrorEventListener } from "./report-error";

const main = () => {
  if (window.top === window.self) {
    return;
  }
  loadGetUserSnapshotEventListener();
  loadReportUrlChangeEventListener();
  loadReportErrorEventListener();
};

main();
