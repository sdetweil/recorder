"use strict";
// Load in smart mirror config
const os = require("os");
const fs = require("fs");
const path = require("path");
var rootpath = ".";
let config;
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
const Sonus = require(path.resolve(rootpath, "node_modules", "sonus"));
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

var hotwords = -1;
const sonus = Sonus.init({ hotwords, language, recordProgram, device }, client);

// Event IPC
sonus.on("partial-result", (result) => {});
sonus.on("final-result", (result) => console.log("text", result));
sonus.on("error", (error) => console.error("!e:", error));

// add support for plugins needing conversational voice support
const express = require(path.resolve(rootpath, "node_modules", "express"));
const app = express();
const server = require("http").createServer(app);

// Start the server, port passed in
server.listen(process.argv[2]);
var control = {};
control.io = require(path.resolve(rootpath, "node_modules", "socket.io"))(
	server
);

control.io.on("connection", function (socket) {
	// send reco result to socket endpoint
	sonus.on("final-result", (result) => {
		//		console.log("received content="+result);
		socket.emit("text", result);
	});
	console.log("incoming connection");
	//console.log("connected")
	socket.emit("connected");

	// stop listening for phrases for our app
	socket.on("stop", function () {
		//			console.log("stop requested")
		Sonus.stop();
		socket.emit("stopped");
	});
	// start listening for phrase for our app
	socket.on("start", function () {
		//			console.log("start requested")
		Sonus.start(sonus);
		socket.emit("started");
	});
});
