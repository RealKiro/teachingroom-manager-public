// Health check for Docker — calls /api/health, exits 0 on success, 1 otherwise.
const http = require("http");

const port = process.env.PORT || 3000;

const req = http.get(`http://localhost:${port}/api/health`, (res) => {
  let body = "";
  res.on("data", (chunk) => (body += chunk));
  res.on("end", () => {
    try {
      const data = JSON.parse(body);
      process.exit(data && data.ok ? 0 : 1);
    } catch {
      process.exit(1);
    }
  });
});

req.on("error", () => process.exit(1));
req.setTimeout(5000, () => {
  req.destroy();
  process.exit(1);
});
req.end();
