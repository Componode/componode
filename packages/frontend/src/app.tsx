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
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ErrorState } from "@/ux/components/patterns/states";
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
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught render error:", error, info);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6" role="alert">
          <ErrorState
            title="Something went wrong"
            description="An unexpected error occurred. Try again — if it persists, check the hub logs."
            onRetry={this.handleRetry}
          />
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
          <TooltipProvider><RouterProvider router={router} /></TooltipProvider>
          <Toaster richColors={false} position="bottom-right" />
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
