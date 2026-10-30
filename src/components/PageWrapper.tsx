import type { PropsWithChildren } from "react";

interface PageWrapperProps extends PropsWithChildren {
  className?: string;
}

export default function PageWrapper({
  children,
  className,
}: PageWrapperProps) {
  return (
    <main className="page-wrapper">
      <div className={["page-content", className].filter(Boolean).join(" ")}>
        {children}
      </div>
    </main>
  );
}
