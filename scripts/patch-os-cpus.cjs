/**
 * vsce secretlint uses os.cpus().length as p-map concurrency; some hosts
 * report 0 CPUs and packaging fails. Force a positive length for the process.
 */
const os = require("os");
const real = os.cpus.bind(os);
os.cpus = () => {
  const cpus = real();
  if (cpus && cpus.length > 0) {
    return cpus;
  }
  return Array.from({ length: 4 }, () => ({
    model: "virtual",
    speed: 0,
    times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
  }));
};
