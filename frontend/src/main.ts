import "./style.css";

const logBox = document.getElementById("log")! as HTMLTextAreaElement;
const reportBox = document.getElementById("report")! as HTMLDivElement;

function generateReportBox() {
  const container = document.createElement("div");
  container.className = "boxes";

  for (let i = 0; i < 100; i++) {
    const box = document.createElement("div");
    box.className = "box";
    container.appendChild(box);
  }
  return container;
}

async function connectWebTransport(url: string) {
  const transport = new WebTransport(url);
  await transport.ready;
  return transport;
}

function log(message: string) {
  logBox.value += message + "\n";
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

  const interval = setInterval(async () => {
    await writer.write(new TextEncoder().encode("PINGPING"));
    await reader.read();
  }, 1000);

  transport.closed.then(() => {
    clearInterval(interval);
  });

  const datagramReader = transport.datagrams.readable.getReader();
  handleDatagram(datagramReader);
}

const fragmentData: Map<number, boolean[][]> = new Map();
function logFragment(
  totalFragment: number,
  testNum: number,
  fragmentNum: number
) {
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
  reportBox.innerHTML = "";
  fragmentData.forEach((value, key) => {
    if (shouldLog) log(`Test: ${key} fragments`);
    drawBoxes(key);
    value.forEach((fragment, i) => {
      const dropped = fragment.filter((v) => !v).length;
      if (shouldLog)
        log(
          `Test ${i}: ${dropped}/${fragment.length}: ${
            (dropped / fragment.length) * 100
          }%`
        );
    });
  });
}

function drawBoxes(totalFragments: number) {
  const container = generateReportBox();
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

  reportBox.appendChild(header);
  reportBox.appendChild(container);
  reportBox.appendChild(document.createElement("hr"));
}

async function handleDatagram(reader: ReadableStreamDefaultReader<Uint8Array>) {
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    const [totalFragments, testNum, fragmentNum, ...rest] = value;
    if (rest.length == 1200) {
      logFragment(totalFragments, testNum, fragmentNum);
    }
  }
}

document.getElementById("start")?.addEventListener("click", main);
document.getElementById("dump")?.addEventListener("click", dumpInfo);
