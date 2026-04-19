export default function ComplianceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-black">Compliance</h1>
        <p className="mt-1 text-gray-600">Policy statement tracking and compliance assessment</p>
      </div>
      <div>{children}</div>
    </div>
  );
}
