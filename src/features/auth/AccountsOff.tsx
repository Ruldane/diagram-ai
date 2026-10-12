/** What every account page says when the server runs in solo mode (no `DIAGRAM_AI_AUTH=on`, or no database). */
export function AccountsOffNote({ className }: { className?: string }) {
  return (
    <p className={className}>
      Accounts are off. Set <code className="font-mono text-[12px]">DIAGRAM_AI_AUTH=on</code> with <code className="font-mono text-[12px]">DATABASE_URL</code> to enable them; see
      docs/auth.md.
    </p>
  );
}
