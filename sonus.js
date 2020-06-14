"use strict";
// Load in smart mirror config
const os = require("os");
const fs = require("fs");
const path = require("path");
var rootpath = ".";
let config;
let first = true;
console.log("arg=" + process.argv[3]);
let debug =
	process.argv.length > 3
		? process.argv[3] == "true"
			? true
			: false
		: false;
console.log("debug=" + debug);
var vn = path.resolve(rootpath, "config.json");
//console.log("path="+vn)
try {
	config = require(vn);
} catch (e) {
	config = false;
}

if (
	!config ||
	!config.speech ||
	!config.speech.keyFilename ||
	!config.speech.hotwords ||
	!config.general.language
) {
	throw "Configuration Error! See: https://docs.smart-mirror.io/docs/configure_the_mirror.html#speech";
}

var keyFile = JSON.parse(
	fs.readFileSync(path.resolve(rootpath, config.speech.keyFilename), "utf8")
);

// Configure Sonus
//const Sonus = require(path.resolve(rootpath, "node_modules", "sonus"));
const Sonus = require("sonus");
const speech = require(path.resolve(
	rootpath,
	"node_modules",
	"@google-cloud/speech"
));
const client = new speech.SpeechClient({
	projectId: keyFile.project_id,
	keyFilename: config.speech.keyFilename,
});

const language = config.general.language;
const recordProgram =
	os.arch().startsWith("arm") |
	(os.arch == "x64" && os.platform() !== "darwin")
		? "arecord"
		: "rec";
const device = config.speech.device != "" ? config.speech.device : "default";

//var hotwords = -1;
const sonus = Sonus.init(
	{ hotwords: -1, language, recordProgram, device },
	client
);

// Event IPC

sonus.on("error", (error) => {
	// forward errors on to client
	Sonus.stop();
	connections.forEach((socket) => {
		if (debug) console.error("!e:", error);
		socket.emit("error", error);
	});
});
// forward partial results on to client
sonus.on("partial-result", (result) => {
	connections.forEach((socket) => {
		if (debug)
			console.log("received partial content from reco engine=" + result);
		socket.emit("partial-text", result);
	});
});
// forward final result on to client
sonus.on("final-result", (result) => {
	connections.forEach((socket) => {
		if (debug)
			console.log("received final content from reco engine=" + result);
		socket.emit("final-text", result);
	});
});

// add support for plugins needing conversational voice support
const express = require(path.resolve(rootpath, "node_modules", "express"));
const app = express();
const server = require("http").createServer(app);

// Start the server, port passed in
server.listen(process.argv[2]);
var started = 0;
var control = {};
control.io = require(path.resolve(rootpath, "node_modules", "socket.io"))(
	server
);
if (debug) console.log("waiting for connection");

const connections = new Set();

control.io.on("connection", function (socket) {
	if (debug) console.log("connected");
	// tell the client we saw the connection
	socket.emit("connected");
	// save the socket for communications back
	connections.add(socket);
	// stop listening for phrases for our app
	socket.on("stop", function () {
		if (debug) console.log("stop requested");
		// stop our reco handler
		console.log("start should be 1=" + started);
		if (started == 1) {
			Sonus.stop();
			--started;
		}
		// tell client reco stopped
		socket.emit("stopped");
	});
	// start listening for phrase for our app
	socket.on("start", function () {
		if (debug) console.log("start requested");
		// start our reco handler
		console.log("start should be 0=" + started);
		if (started++ == 0) Sonus.start(sonus);
		// tell client reco started
		socket.emit("started");
	});
	socket.on("disconnect", () => {
		if (debug) console.log("client disconnected");
		socket.removeAllListeners();
		connections.delete(socket);
	});
});
