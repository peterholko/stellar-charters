import { Component, StrictMode, Suspense, lazy, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthGate } from "./auth/AuthGate";
import "./theme/tokens.css";
import "./styles.css";

// Dev-only visual harness (own lazy chunk, never loaded in production since devPreview is always false).
const devPreview = import.meta.env.DEV && window.location.pathname === "/preview";
const PreviewGallery = lazy(() => import("./dev/PreviewGallery").then((m) => ({ default: m.PreviewGallery })));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error) {
      return (
        <pre style={{ color: "#ff8080", background: "#0a0a0c", padding: 20, fontSize: 12, whiteSpace: "pre-wrap", minHeight: "100vh" }}>
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      {devPreview ? (
        <Suspense fallback={null}>
          <PreviewGallery />
        </Suspense>
      ) : (
        <AuthGate>
          <App />
        </AuthGate>
      )}
    </ErrorBoundary>
  </StrictMode>,
);
