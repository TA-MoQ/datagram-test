import "./style.css";
// @ts-ignore grrr
import Plotly from "plotly.js-dist";

const logBox = document.getElementById("log")! as HTMLTextAreaElement;
const reportBox = document.getElementById("report")! as HTMLDivElement;
const runWarmupCheckbox = document.getElementById(
  "runWarmup"
)! as HTMLInputElement;
const sleepBetweenFragmentsCheckbox = document.getElementById(
  "sleepBetweenFragments"
)! as HTMLInputElement;

function generateReportBox(totalFragments: number): [HTMLDivElement, boolean] {
  const existing = document.getElementById(`boxes-${totalFragments}`);
  if (existing) {
    return [existing as HTMLDivElement, true];
  }

  const container = document.createElement("div");
  container.className = "boxes";
  container.id = `boxes-${totalFragments}`;

  for (let i = 0; i < 100; i++) {
    const box = document.createElement("div");
    box.className = "box";
    container.appendChild(box);
  }
  return [container, false];
}

async function connectWebTransport(url: string) {
  const transport = new WebTransport(url);
  await transport.ready;
  return transport;
}

function log(message: string, newLine = true) {
  logBox.value += message;
  if (newLine) {
    logBox.value += "\n";
  }
}

async function main() {
  prepareMaps();
  const urlParams = new URLSearchParams(window.location.search);
  const url = urlParams.get("url") || "https://localhost:4443";
  log(`Connecting to ${url}`);

  const transport = await connectWebTransport(url);
  log("Connected");

  const reader = transport.incomingUnidirectionalStreams.getReader();

  const stream = await transport.createUnidirectionalStream();
  const writer = stream.getWriter();
  log("Sending RUNTESTS");
  await writer.write(new TextEncoder().encode("RUNTESTS"));
  await writer.write(
    new TextEncoder().encode(runWarmupCheckbox.checked ? "1" : "0")
  );
  await writer.write(
    new TextEncoder().encode(sleepBetweenFragmentsCheckbox.checked ? "1" : "0")
  );
  startTime = Date.now();

  const datagramReader = transport.datagrams.readable.getReader();
  handleDatagram(datagramReader);
  handleStream(reader);
}

const fragmentData: Map<number, boolean[][]> = new Map();
const latencyData: Map<number, [time: number, delta: number][]> = new Map();
const finishLatencyData: Map<
  number,
  [startTime: number | null, endTime: number | null][]
> = new Map();
let startTime: number = 0;

// const fragments = [10, 25, 50, 75, 100, 150, 200];
const fragments = [10, 25, 30, 50];

function prepareMaps() {
  fragmentData.clear();
  latencyData.clear();
  finishLatencyData.clear();

  fragments.forEach((totalFragment) => {
    latencyData.set(totalFragment, []);

    const z = [];
    for (let i = 0; i < 100; i++) {
      z.push([null, null]);
    }
    // @ts-ignore: type is correct
    finishLatencyData.set(totalFragment, z);

    const arr = new Array(100);
    for (let i = 0; i < 100; i++) {
      arr[i] = new Array(totalFragment).fill(false);
    }
    fragmentData.set(totalFragment, arr);
  });
}

function logFragment(
  totalFragment: number,
  testNum: number,
  fragmentNum: number,
  time: number
) {
  const t = Date.now();
  finishLatencyData.get(totalFragment)![testNum][0] = Math.min(
    finishLatencyData.get(totalFragment)![testNum][0] ?? 99999999999999999999,
    time / 1000
  );
  finishLatencyData.get(totalFragment)![testNum][1] = Math.max(
    finishLatencyData.get(totalFragment)![testNum][1] ?? 0,
    t / 1000
  );
  latencyData.get(totalFragment)!.push([t - startTime, t - time]);

  const data = fragmentData.get(totalFragment)!;
  data[testNum][fragmentNum] = true;
  dumpInfo(false);
}

function dumpInfo(shouldLog = true) {
  fragmentData.forEach((value, key) => {
    if (shouldLog) log(`============ ${key} fragments ============`);
    drawBoxes(key);

    let totalFailed = 0;
    value.forEach((fragment, i) => {
      const dropped = fragment.filter((v) => !v).length;
      if (dropped > 0) {
        totalFailed += 1;
      }

      if (shouldLog && dropped > 0)
        log(`Test ${i} failed: ${dropped}/${fragment.length} packets dropped`);
    });

    if (shouldLog) log(`Total failed tests: ${totalFailed}/${value.length}`);
  });
}

function drawBoxes(totalFragments: number) {
  const [container, alreadyExisting] = generateReportBox(totalFragments);
  const boxes = Array.from(container.children) as HTMLDivElement[];
  const data = fragmentData.get(totalFragments)!;
  data.forEach((fragment, i) => {
    const dropped = fragment.filter((v) => !v).length;
    const percentage = dropped / totalFragments;
    const box = boxes[i];

    const r = Math.floor(percentage * 255);
    const g = Math.floor((1 - percentage) * 255);
    box.style.backgroundColor = `rgba(${r}, ${g}, 0, 1)`;
  });

  const header = document.createElement("p");
  header.textContent = `Test: ${totalFragments} fragments`;

  if (!alreadyExisting) {
    reportBox.appendChild(header);
    reportBox.appendChild(container);
    reportBox.appendChild(document.createElement("hr"));
  }
}

async function handleDatagram(reader: ReadableStreamDefaultReader<Uint8Array>) {
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (new TextDecoder().decode(value).startsWith("WARPTEST")) {
      continue;
    }

    const [
      totalFragments,
      testNum,
      fragmentNum,
      n1,
      n2,
      n3,
      n4,
      n5,
      n6,
      n7,
      n8,
      ...rest
    ] = value;
    if (rest.length == 1200) {
      logFragment(
        totalFragments,
        testNum,
        fragmentNum,
        parseInt(
          n1.toString(2).padStart(8, "0") +
            n2.toString(2).padStart(8, "0") +
            n3.toString(2).padStart(8, "0") +
            n4.toString(2).padStart(8, "0") +
            n5.toString(2).padStart(8, "0") +
            n6.toString(2).padStart(8, "0") +
            n7.toString(2).padStart(8, "0") +
            n8.toString(2).padStart(8, "0"),
          2
        )
      );
    }
  }
}

async function handleStream(
  reader: ReadableStreamDefaultReader<ReadableStreamDefaultReader<Uint8Array>>
) {
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    const streamReader =
      // @ts-ignore: type is correct
      value.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    while (true) {
      const { value, done } = await streamReader.read();
      if (done) {
        break;
      }
      new TextDecoder().decode(value);
      // log(".", false);
    }
  }
}

document.getElementById("start")?.addEventListener("click", main);
document
  .getElementById("dump")
  ?.addEventListener("click", () => dumpInfo(true));

// // create plot with plotly of latency data
// document.getElementById("plotbtn")?.addEventListener("click", () => {
//   const data = Array.from(latencyData.entries()).map(
//     ([totalFragments, values]) => {
//       return {
//         x: values.map((v) => v[0] / 1000),
//         y: values.map((v) => v[1] / 1000),
//         mode: "lines" as const,
//         type: "scatter" as const,
//         name: `${totalFragments} fragments`,
//       };
//     }
//   );

//   Plotly.newPlot("plot", data, {
//     title: "Latency data",
//     xaxis: {
//       title: "Test duration (s)",
//     },
//     yaxis: {
//       title: "Latency (m)",
//     },
//   });

//   // create a bar plot for average latency per fragments
//   const avgData = Array.from(latencyData.entries()).map(
//     ([totalFragments, values]) => {
//       const avg = values.reduce((acc, v) => acc + v[1], 0) / values.length;
//       return {
//         x: [totalFragments],
//         y: [avg / 1000],
//         type: "bar" as const,
//         name: `${totalFragments} fragments`,
//       };
//     }
//   );

//   Plotly.newPlot("avgplot", avgData, {
//     title: "Average fragment latency per test",
//     xaxis: {
//       title: "Number of fragments",
//     },
//     yaxis: {
//       title: "Average latency (s)",
//     },
//   });

//   // create a for bar plot for finish latency per fragments
//   const finishData = Array.from(finishLatencyData.entries()).map(
//     ([totalFragments, values]) => {
//       const avg =
//         values
//           .filter((x) => x[0] != null && x[1] != null)
//           // @ts-ignore already checked
//           .reduce((acc, v) => acc + (v[1] - v[0]), 0) / values.length;
//       return {
//         x: [totalFragments],
//         y: [avg],
//         type: "bar" as const,
//         name: `${totalFragments} fragments`,
//       };
//     }
//   );

//   Plotly.newPlot("finishplot", finishData, {
//     title: "Finish latency per test",
//     xaxis: {
//       title: "Number of fragments",
//     },
//     yaxis: {
//       title: "Finish latency (s)",
//     },
//   });

//   const dropRateData = Array.from(fragmentData.entries()).map(
//     ([totalFragments, testResults]) => ({
//       x: [totalFragments],
//       y: [
//         (testResults.reduce(
//           (acc, test) =>
//             acc + test.filter((fragment) => !fragment).length / test.length,
//           0
//         ) /
//           testResults.length) *
//           100,
//       ],
//       type: "bar",
//       name: `${totalFragments} fragments`,
//     })
//   );

//   Plotly.newPlot("dropplot", dropRateData, {
//     title: "Average Drop Rate per Fragment Count",
//     xaxis: { title: "Number of fragments" },
//     yaxis: {
//       title: "Drop rate (%)",
//       range: [0, 100],
//     },
//   });

//   const failedTestRateData = Array.from(fragmentData.entries()).map(
//     ([totalFragments, testResults]) => ({
//       x: [totalFragments],
//       y: [
//         (testResults.filter((test) => test.some((fragment) => !fragment))
//           .length /
//           testResults.length) *
//           100,
//       ],
//       type: "bar",
//       name: `${totalFragments} fragments`,
//     })
//   );

//   Plotly.newPlot("failplot", failedTestRateData, {
//     title: "Failed Test Rate per Fragment Count",
//     xaxis: { title: "Number of fragments" },
//     yaxis: {
//       title: "Failed test rate (%)",
//       range: [0, 100],
//     },
//   });
// });

// Modify the plotting code section:
document.getElementById("plotbtn")?.addEventListener("click", () => {
  // Latency scatter plot
  const data = Array.from(latencyData.entries()).map(
    ([totalFragments, values]) => {
      return {
        x: values.map((v) => v[0] / 1000),
        y: values.map((v) => v[1] / 1000),
        mode: "lines",
        type: "scatter",
        name: `${totalFragments} fragments`,
      };
    }
  );

  Plotly.newPlot("plot", data, {
    title: "Latency data",
    xaxis: {
      title: "Test duration (s)",
      tickmode: "array",
      tickvals: fragments,
    },
    yaxis: {
      title: "Latency (m)",
    },
  });

  // Average latency bar plot
  const avgData = Array.from(latencyData.entries()).map(
    ([totalFragments, values]) => {
      const avg = values.reduce((acc, v) => acc + v[1], 0) / values.length;
      return {
        x: [totalFragments],
        y: [avg / 1000],
        type: "bar",
        name: `${totalFragments} fragments`,
      };
    }
  );

  Plotly.newPlot("avgplot", avgData, {
    title: "Average fragment latency per test",
    xaxis: {
      title: "Number of fragments",
      tickmode: "array",
      tickvals: fragments,
    },
    yaxis: {
      title: "Average latency (s)",
    },
  });

  // Finish latency bar plot
  const finishData = Array.from(finishLatencyData.entries()).map(
    ([totalFragments, values]) => {
      const avg =
        values
          .filter((x) => x[0] != null && x[1] != null)
          // @ts-ignore already checked
          .reduce((acc, v) => acc + (v[1] - v[0]), 0) / values.length;
      return {
        x: [totalFragments],
        y: [avg],
        type: "bar",
        name: `${totalFragments} fragments`,
      };
    }
  );

  // Create box plot data
  const boxPlotData = Array.from(finishLatencyData.entries()).map(
    ([totalFragments, values]) => {
      const latencies = values
        .filter((x) => x[0] != null && x[1] != null)
        .map((v) => v[1] - v[0]);

      return {
        x: Array(latencies.length).fill(totalFragments),
        y: latencies,
        type: "box",
        name: `${totalFragments} fragments`,
        boxpoints: "outliers",
        jitter: 0.3,
        pointpos: 0,
      };
    }
  );

  // Combine both visualizations in a subplot
  const layout = {
    title: "Finish Latency",
    grid: {
      rows: 2,
      columns: 1,
      pattern: "independent",
      roworder: "top to bottom",
    },
    yaxis: {
      title: "Finish Latency (s)",
      domain: [0.55, 1],
      dtick: 0.04,
    },
    yaxis2: {
      title: "Finish Latency Distribution (s)",
      domain: [0, 0.45],
      dtick: 0.01,
    },
    xaxis: {
      title: "Number of fragments",
      tickmode: "array",
      tickvals: fragments,
      domain: [0.1, 1],
    },
    xaxis2: {
      title: "Number of fragments",
      tickmode: "array",
      tickvals: fragments,
      domain: [0.1, 1],
    },
    showlegend: false,
    height: 800,
  };

  Plotly.newPlot("finishplot", [...finishData, ...boxPlotData], layout);

  // Drop rate bar plot
  const dropRateData = Array.from(fragmentData.entries()).map(
    ([totalFragments, testResults]) => ({
      x: [totalFragments],
      y: [
        (testResults.reduce(
          (acc, test) =>
            acc + test.filter((fragment) => !fragment).length / test.length,
          0
        ) /
          testResults.length) *
          100,
      ],
      type: "bar",
      name: `${totalFragments} fragments`,
    })
  );

  Plotly.newPlot("dropplot", dropRateData, {
    title: "Average Drop Rate per Fragment Count",
    xaxis: {
      title: "Number of fragments",
      tickmode: "array",
      tickvals: fragments,
    },
    yaxis: {
      title: "Drop rate (%)",
      range: [0, 100],
    },
  });

  // Failed test rate bar plot
  const failedTestRateData = Array.from(fragmentData.entries()).map(
    ([totalFragments, testResults]) => ({
      x: [totalFragments],
      y: [
        (testResults.filter((test) => test.some((fragment) => !fragment))
          .length /
          testResults.length) *
          100,
      ],
      type: "bar",
      name: `${totalFragments} fragments`,
    })
  );

  Plotly.newPlot("failplot", failedTestRateData, {
    title: "Failed Test Rate per Fragment Count",
    xaxis: {
      title: "Number of fragments",
      tickmode: "array",
      tickvals: fragments,
    },
    yaxis: {
      title: "Failed test rate (%)",
      range: [0, 100],
    },
  });
});

function downloadAsCsv(csv: string, headers: string[]) {
  csv = headers.join(",") + "\n" + csv;
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // download
  a.href = url;
  a.download = "latency.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("export")!.addEventListener("click", () => {
  // export all map data as csv
  const csv = Array.from(latencyData.entries())
    .map(([totalFragments, values]) => {
      return values.map((v) => `${totalFragments},${v[0]},${v[1]}`).join("\n");
    })
    .join("\n");
  downloadAsCsv(csv, ["totalFragments", "time", "delta"]);

  // export all finish latency data as csv
  const finishCsv = Array.from(finishLatencyData.entries())
    .map(([totalFragments, values]) => {
      return values
        .map((v) => `${totalFragments},${v[0] ?? ""},${v[1] ?? ""}`)
        .join("\n");
    })
    .join("\n");
  downloadAsCsv(finishCsv, ["totalFragments", "startTime", "endTime"]);

  // export all fragment data as csv
  const fragmentCsv = Array.from(fragmentData.entries())
    .map(([totalFragments, values]) => {
      return values
        .map((v, i) => {
          return v
            .map((x, j) => `${totalFragments},${i},${j},${x ? 1 : 0}`)
            .join("\n");
        })
        .join("\n");
    })
    .join("\n");

  downloadAsCsv(fragmentCsv, [
    "totalFragments",
    "testNum",
    "fragmentNum",
    "received",
  ]);
});
