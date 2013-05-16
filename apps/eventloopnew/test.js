// Run some tests of how fast the event loop spins. Was seeing delays of
// 20-80ms in email app.

// Set up a "fastTick" which uses postMessage
var timeouts = [];
var messageName = "zero-timeout-message";

function handleMessage(event) {
  if (event.source == window && event.data == messageName) {
    event.stopPropagation();
    if (timeouts.length > 0) {
      var fn = timeouts.shift();
      fn();
    }
  }
}

window.addEventListener("message", handleMessage, true);

function fastTick(fn) {
  timeouts.push(fn);
  window.postMessage(messageName, "*");
};

function timeSink() {
  // Hacky way to insert a signal in the
  // perf capture to indicate where to start
  // inspecting the delay in the loop
  for (var i = 0; i < 1000000; i++) {

  }
}

function timeSink2() {
  // Hacky way to insert a signal in the
  // perf capture to indicate where to start
  // inspecting the delay in the loop
  for (var i = 0; i < 1000000; i++) {

  }
}

function run() {
  document.mozDelayLoadEvent();
  console.log('NEW starting test by preloading console overhead...');

  // First create a marker for the perf capture.
  timeSink();

  var start = performance.now();
  // Try fastTick
  fastTick(function () {
    console.log('NEW FAST TICK DONE IN: ' + (performance.now() - start));

timeSink2();
    // setTimeout on default granularity, should be 4ms?
    start = performance.now();
    setTimeout(function () {
      console.log('NEW DEFAULT SET TIMEOUT DONE IN: ' + (performance.now() - start));

      // setTimeout on explicit granularity of 0 (should be upshifted by
      // platform to 4ms)
      start = performance.now();
      setTimeout(function () {
        console.log('0 NEW SET TIMEOUT DONE IN: ' + (performance.now() - start));

        // setTimeout on explicit granularity of 4ms
        start = performance.now();
        setTimeout(function () {
          console.log('4ms NEW SET TIMEOUT DONE IN: ' + (performance.now() - start));
          document.mozStopDelayingLoadEvent();
        }, 4);

      }, 0);
    });
  });
}
run();
/*
function runSerial() {
  // Try fastTick
  var start = performance.now();

  fastTick(function () {
    console.log('serial: FAST TICK DONE IN: ' + (performance.now() - start));
  });
  // setTimeout on default granularity, should be 4ms?
  setTimeout(function () {
    console.log('serial: DEFAULT SET TIMEOUT DONE IN: ' + (performance.now() - start));
  });
  // setTimeout on explicit granularity of 0 (should be upshifted by
  // platform to 4ms)
  setTimeout(function () {
    console.log('serial: 0 SET TIMEOUT DONE IN: ' + (performance.now() - start));
  }, 0);
  // setTimeout on explicit granularity of 4ms
  setTimeout(function () {
    console.log('serial: 4ms SET TIMEOUT DONE IN: ' + (performance.now() - start));
  }, 4);
}
runSerial();
*/