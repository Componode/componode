import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { toast } from "sonner";
import { routes } from "./routes";
import { ThemeProvider } from "@/ux/components/app/theme-provider";
import { Toaster } from "@/ux/components/ui/sonner";
import type { ApiError } from "@/api/client";

// Global default error UX per ADR-072: 401 → login redirect, 403 → permission
// toast, 429 → rate-limit toast, 500 → generic toast. Mutations that need
// inline field errors (422) handle their own onError.
function handleGlobalError(error: unknown) {
  const err = error as ApiError & { status?: number };
  if (err?.code === "AUTH_NO_SESSION") {
    if (window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    return;
  }
  if (err?.code === "FORBIDDEN") {
    toast.error("You don't have permission to do that.");
    return;
  }
  if (err?.code === "RATE_LIMITED") {
    toast.warning("Rate limited — retrying shortly.");
    return;
  }
  // 422 field errors are handled locally by form mutations.
  if (err?.code === "VALIDATION_FAILED") return;
  toast.error("Something went wrong. Please try again.");
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalError }),
  mutationCache: new MutationCache({ onError: handleGlobalError }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createBrowserRouter(routes);

interface ErrorBoundaryState {
  hasError: boolean;
  message: string | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught render error:", error, info);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, message: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="flex min-h-screen items-center justify-center bg-background p-6"
          role="alert"
        >
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              {this.state.message ?? "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster richColors={false} position="bottom-right" />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
