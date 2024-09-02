export const loadReportErrorEventListener = (() => {
  let isInitialized = false;

  const extractError = ({ message, lineno, colno, filename, error }) => {
    return { message, lineno, colno, filename, stack: error?.stack };
  };

  return () => {
    if (isInitialized) return;

    const reportedErrors = new Set();

    const generateErrorId = (event) => {
      const { lineno, colno, filename, message } = event;
      return `${message}|${filename}|${lineno}|${colno}`;
    };

    const isErrorAlreadyReported = (errorId) => {
      if (reportedErrors.has(errorId)) {
        return true;
      }
      reportedErrors.add(errorId);
      // Optionally, clear the set after some time to prevent it from growing indefinitely
      setTimeout(() => reportedErrors.delete(errorId), 5000);
      return false;
    };

    const reportError = (event) => {
      const errorId = generateErrorId(event);

      // Prevent error being reported multiple times
      if (isErrorAlreadyReported(errorId)) {
        return;
      }

      const error = extractError(event);

      console.log("GOTERR EVENT", event);
      console.log("GOTERR ", error);

      window.top.postMessage(
        { type: "RUNTIME_ERROR", error },
        "https://gptengineer.app"
      );
      window.top.postMessage(
        { type: "RUNTIME_ERROR", error },
        "http://localhost:3000"
      );
    };

    // Listen to runtime errors and report them to the parent window
    window.addEventListener("error", reportError);

    // Listen to unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      if (!event.reason?.stack) {
        return;
      }

      const errorId =
        event.reason?.stack || event.reason?.message || String(event.reason);

      // Prevent error being reported multiple times
      if (isErrorAlreadyReported(errorId)) {
        return;
      }

      const error = {
        message: event.reason?.message || "Unhandled promise rejection",
        stack: event.reason?.stack || String(event.reason),
      };

      console.log("GOT UNHANDLED PROMISE REJECTION", event);
      console.log("GOT UNHANDLED PROMISE REJECTION ", error);

      window.top.postMessage(
        { type: "UNHANDLED_PROMISE_REJECTION", error },
        "https://gptengineer.app"
      );
      window.top.postMessage(
        { type: "UNHANDLED_PROMISE_REJECTION", error },
        "http://localhost:3000"
      );
    });

    isInitialized = true;
  };
})();
