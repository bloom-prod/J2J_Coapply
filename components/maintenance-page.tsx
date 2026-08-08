"use client";

export function MaintenancePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "hsl(var(--background))",
        padding: "24px",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 420 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            margin: "0 auto 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 32,
            background: "linear-gradient(135deg, var(--pink-200), var(--sage-200))",
          }}
        >
          🌿
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--text-dark)",
            marginBottom: 8,
          }}
        >
          Under Maintenance
        </div>
        <div style={{ fontSize: 14, color: "var(--text-mid)", lineHeight: 1.6 }}>
          We're watering the garden right now. bloom tracker will be back in a
          bit — hang tight!
        </div>
      </div>
    </div>
  );
}