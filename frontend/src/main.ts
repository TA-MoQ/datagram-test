import "./style.css";
import Plotly from "plotly.js-dist";

const logBox = document.getElementById("log")! as HTMLTextAreaElement;
const reportBox = document.getElementById("report")! as HTMLDivElement;

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
  startTime = Date.now();

  const datagramReader = transport.datagrams.readable.getReader();
  handleDatagram(datagramReader);
  handleStream(reader);
}

const fragmentData: Map<number, boolean[][]> = new Map();
const latencyData: Map<number, [time: number, delta: number][]> = new Map();
let startTime: number = 0;

function logFragment(
  totalFragment: number,
  testNum: number,
  fragmentNum: number,
  time: number
) {
  if (!latencyData.has(totalFragment)) {
    latencyData.set(totalFragment, []);
  }

  const t = Date.now();
  latencyData.get(totalFragment)!.push([t - startTime, t - time]);

  let k = fragmentData.has(totalFragment);
  if (!k) {
    log(`Test for ${totalFragment} started`);
    const arr = new Array(100);
    for (let i = 0; i < 100; i++) {
      arr[i] = new Array(totalFragment).fill(false);
    }
    fragmentData.set(totalFragment, arr);
    return;
  }

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

    // @ts-ignore
    const streamReader = value.getReader() as ReadableStream<Uint8Array>;
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

// create plot with plotly of latency data
document.getElementById("plotbtn")?.addEventListener("click", () => {
  const data = Array.from(latencyData.entries()).map(
    ([totalFragments, values]) => {
      return {
        x: values.map((v) => v[0] / 1000),
        y: values.map((v) => v[1]),
        mode: "lines" as const,
        type: "scatter" as const,
        name: `${totalFragments} fragments`,
      };
    }
  );

  Plotly.newPlot("plot", data, {
    title: "Latency data",
    xaxis: {
      title: "Test duration (s)",
    },
    yaxis: {
      title: "Latency (ms)",
    },
  });
});
