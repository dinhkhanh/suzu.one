"use client";

// Replaces the root layout when even that fails, so it cannot rely on translations or styles
// being available. Both languages, plain markup.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", maxWidth: "32rem", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Đã có lỗi xảy ra · Something went wrong</h1>
        <p style={{ color: "#555" }}>Lỗi đã được ghi nhận. Vui lòng thử lại sau ít phút. · The error has been recorded. Please try again in a few minutes.</p>
        {error.digest ? <p style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#777" }}>{error.digest}</p> : null}
        <button onClick={() => retry()} style={{ padding: "0.5rem 1rem" }}>
          Thử lại · Try again
        </button>
      </body>
    </html>
  );
}
