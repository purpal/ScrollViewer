const fs = require('fs');
const path = require('path');

//------------------------------------------------------------------------------------------

var config;
var curr = null;
var timeTemp;
var reList = null;
var stage;
var scale;
var origWidth;
var nail = false;

//------------------------------------------------------------------------------------------

function showMsg(msg) {
	$("#txt").text(msg);
}

function trans(str) {
	return str.replace(/\\/g, "/");
}

function escape(str) {
	return str.replace(/\\/g, "\\\\");
}

function removeSimg() {
	$(".simg").each(function() {
		URL.revokeObjectURL($(this).attr("src"));
		$(this).remove();
	});
}

function showSimg(files, first) {
	if(files.length <= 0)
		return;
	var f = files.shift();
	f.async('blob').then(function(b) {
		burl = URL.createObjectURL(b);
		if(first == true)
			$("#pic").attr("src", burl);
		else {
			var simg = $("<img id='" + f.name + "' class='simg' src='" + burl + "'>");
			simg.appendTo("#picList");
		}
		showSimg(files, false);
	});
}

function updateHistory(src) {
	if(!("history" in config)) {
		console.log("history is not declared!! new object");
		config.history = {};
	}
	if(typeof config.history != 'object') {
		console.log("history is not an object!! renew object");
		config.history = {};
	}
	config.history[config.path] = src;
	console.log("[history] " + config.path + " : " + src);
}

function readHistory() {
	if(!("history" in config))
		return undefined;
	if(typeof config.history != 'object')
		return undefined;
	return config.history[config.path];
}

function saveCurr() {
	if(!curr)
		return;
	$("#" + curr.id).attr("vpos", $("#page").scrollTop());
	console.log("vpos: " + $("#" + curr.id).attr("vpos"));
	$("#" + curr.id).css({'color': 'black'});
}

function clean() {
	$("#titleList").empty();
	$("#pic").attr("src", "");
	showMsg("");
	curr = null;
	removeSimg();
}

function sortList() {
	if(config.sort == "time") {
		reList.sort(function(a, b) {
			if(a.date == undefined)
				return new Date(b.modifiedTime) - new Date(a.modifiedTime);
			else
				return new Date(b.date) - new Date(a.date);
		});
	}
	else if(config.sort == "nameu") {
		reList.sort(function(a, b) {
			return a.name.localeCompare(b.name);
		});
	}
	else if(config.sort == "named") {
		reList.sort(function(a, b) {
			return b.name.localeCompare(a.name);
		});
	}
}

// local storage functions ------------------------------------------------------------------------------------

function removeSingle(str) {
	return str.replace(/\\'/g, "'");
}

function escapeSingle(str) {
	return str.replace(/'/g, "\\'");
}

// network version: ftpDownload(), driveDownload()
function showImg(node) {
	saveCurr();
	curr = node;
	var src = $("#" + curr.id).attr("url");
	src = removeSingle(src);
	updateHistory(src);
	$("#" + curr.id).css({'color': 'red'}).focus();
	showMsg(path.basename(src));
	if(path.extname(src) === '.zip') {
		fs.readFile(src, (err, data) => {
			if(err) throw err;
			var zip = new JSZip();
			zip.loadAsync(data).then(zip => {
				var files = zip.file(/\.jpg|\.png|\.gif|\.bmp/);
				console.log("zip's file: " + files.length);
				removeSimg();
				showSimg(files, true);
			});
		});
	}
	else {
		removeSimg();
		$("#pic").attr("src", src);
	}
	$("#picList").focus();
}

function getFileTime(files, lists, callback) {
	if(files.length > 0) {
		var f = files.shift();
		var timeTemp = {};
		timeTemp['name'] = f;
		var p = trans(path.join(config.path, f));
		fs.stat(p, (err, stats) => {
			timeTemp['date'] = stats.mtime;
			lists.push(timeTemp);
			getFileTime(files, lists, callback);
		});
	}
	else
		callback(lists);
}

function makeReLocal(reSort = false) {
	sortList();
	var refi = -1;
	var history = readHistory();
	for(var index in reList) {
		var file = reList[index].name;
		var ext = path.extname(file);
		if(ext == ".bmp" || ext == ".jpg" || ext == ".png" || ext == ".gif" || ext == ".zip") {
			var src = trans(path.join(config.path, file));
			var vp = (config.lastfile == src) ? config.vpos : 0;
			var re = $('<div id="re' + index + '" class="ti" vpos="' + vp + '" url="' + escapeSingle(src) + '" onclick="showImg(this)" tabindex="' + index + 10 + '">' + path.basename(file, ext) + '</div>');
			re.appendTo("#titleList");
			if(reSort == false) {
				if(config.lastfile == src || history == src)
					refi = index;
			}
			else {
				if($("#txt").text() == file)
					refi = index;
			}
		}
	}
	if(reSort == false) {
		if(refi != -1)
			$("#re" + refi).click();
	}
	else {
		if(refi != -1) {
			curr = document.getElementById("re" + refi);
			$("#" + curr.id).css({'color': 'red'});
		}
	}
	$("#fileDialog").attr('nwworkingdir', config.path);	
}

function chooseFile() {
	var chooser = $("#fileDialog");
	chooser.unbind('change');
	chooser.change(evt => {
		if($("#fileDialog").val() !== '') {
			config.path = $("#fileDialog").val();
			$("#fileDialog").val('');
		}
		openPath();
		//this.attr('nwworkingdir', config.path);
	});
	//chooser.attr('nwworkingdir', config.path);
	chooser.trigger('click');
}

function openPath() {
	clean();
	fs.readdir(config.path, (err, files) => {
		if(err) {
			showMsg(err);
			return;
		}
		var lists = [];
		getFileTime(files, lists, resp => {
			clean();
			reList = resp;
			stage = "local";
			makeReLocal();
		});
	});
}

//------------------------------------------------------------------------------------------


// windows function ------------------------------------------------------------------------

function myTop() {
	$("#page").scrollTop(0);
}

function myNext() {
	if(!curr)
		return;
	var n;
	if(config.sort == 'nameu')
		n = curr.nextSibling;
	else
		n = curr.previousSibling;
	if(n)
		n.click();
	else
		alert("已經是目錄結尾");
}

function myPrev() {
	if(!curr)
		return;
	var p;
	if(config.sort == 'nameu')
		p = curr.previousSibling;
	else
		p = curr.nextSibling;
	if(p)
		p.click();
	else
		alert("已經是目錄開頭");
}

function setLayout() {
	console.log('setLayout');
	var win = nw.Window.get();
	var w = win.width;
	var h = win.height;
	// console.log('w=' + w + ', y=' + h);
	var wDiff = w - window.innerWidth;
	var hDiff = h - window.innerHeight;
	// console.log('wDiff=' + wDiff + ', hDiff=' + hDiff);
	var menuw = $('#my_slider_menu').width();
	var navw = $('#my_nav').width();
	var helpw = $('#my_help').width();

	$('#page').css('height', (h - hDiff - 2) + 'px');
	$('#my_slider_content').css('height', (h - 150 - hDiff - 2) + 'px');
	// 展開後最左邊
	$('#my_slider_menu').css('height', (h - hDiff - 3) + 'px');
	$('#my_slider_scroll').css('height', (h - hDiff - 3) + 'px');

	$('#page').css('width', (w - menuw - wDiff) + 'px');
	$('#my_header').css('width', (w - menuw - 17 - wDiff) + 'px');
	$('#my_nav').css('left', ((w - menuw - 17 - navw - wDiff) / 2 + menuw) + 'px');
	$('#my_help').css('left', ((w - menuw - 17 - helpw - wDiff) / 2 + menuw) + 'px');
}

function setScale() {
	scale = (scale === undefined) ? 100 : scale;
	var w = Math.floor(origWidth * scale / 100);
	$('#pic').width(w);
	$('.simg').each(function() { $(this).width(w); });
	$('#picList').width(w);
}

function zoomOut() {
	scale = (scale === undefined) ? 100 : scale;
	scale = ((scale - 5) > 0) ? (scale - 5) : 5;
	setScale();
}

function zoomIn() {
	scale = (scale === undefined) ? 100 : scale;
	scale += 5;
	setScale();
}

function zoomOrig() {
	scale = 100;
	setScale();
}

function nailSlider() {
	nail = !nail;
	if(nail == false)
		$("#menu_icon").removeClass('nail');
	else {
		$("#menu_icon").addClass('nail');
		$("#my_slider_scroll").css('left', '54px');
	}
}

function showHelp() {
	var win = nw.Window.get();
	var h = win.height;
	var hh = $('#my_help').height();
	$('#my_help').animate({top: ((h - hh) / 2) + 'px'}, 200);
}

function hideHelp() {
	var hh = $('#my_help').height();
	$('#my_help').animate({top: '-' + hh + 'px'}, 200);
}

function bindHotkey() {
	Mousetrap.bind('left', myPrev);
	Mousetrap.bind('right', myNext);
	Mousetrap.bind('-', zoomOut);
	Mousetrap.bind('plus', zoomIn);
	Mousetrap.bind('=', zoomOrig);
	Mousetrap.bind('enter', zoomOrig);
	Mousetrap.bind('f1', showHelp);
	Mousetrap.bind('ctrl+o', chooseFile);
}

function readConfig() {
	//restore history
	fs.readFile(path.join(nw.App.dataPath, "config.json"), function(err, data) {
		if(err) {
			config = {"path": "", "file": "", "vpos": 0, "sort": "nameu", "history": {}};
			console.log("create config.json");
		}
		else {
			config = JSON.parse(data);
			console.log(config);
		}
		$("input[name=sort][value=" + config.sort + "]").attr("checked", true);
		if(config.path !== "")
			openPath();
	});	
}

function bindSort() {
	$("input[name=sort]").change(function() {
		config.sort = this.value;
		$("#titleList").empty();
		makeReLocal(true);
	});
}

function bindAnimate() {
	var ssw = $("#my_slider_scroll").width();
	var menuw = $("#my_slider_menu").width();
	$("#my_slider_menu").mouseover(function() {
		if(nail == false && $("#my_slider_scroll").css('left') == (('-' + (ssw - menuw)) + 'px'))
			$("#my_slider_scroll").animate({left: (menuw - 10) + 'px'}, 200);
	});
	$("#my_slider_scroll").mouseleave(function() {
		if(nail == false && $("#my_slider_scroll").css('left') == ((menuw - 10) + 'px'))
		$("#my_slider_scroll").animate({left: (('-' + (ssw - menuw)) + 'px')}, 200);
	});	
	$("#picList").mouseover(function() {
		$('#my_nav').fadeTo(200, 0.8);
	});
	$("#picList").mouseleave(function() {
		if($('#my_nav:hover').length <= 0)
			$('#my_nav').fadeTo(200, 0);
	});
}

function setWindow() {
	//setup window
	var win = nw.Window.get();
	console.log("width: " + win.width + "  height: " + win.height);
	setLayout();

	['resize', 'maximize', 'restore'].forEach(function(eventType) {
		win.on(eventType, function() {
			setLayout();
		});	
	});

//	if(process.versions['nw-flavor'] == "sdk")
//		win.showDevTools();	
	win.on("close", function() {
		if(curr) {
			config.lastfile = removeSingle($("#" + curr.id).attr("url"));
			config.vpos = $("#page").scrollTop();
		}
		this.hide();
		console.log("closing....");
		fs.writeFile(
			path.join(nw.App.dataPath, "config.json"), 
			JSON.stringify(config, null, 2), 
			(err) => {
				this.close(true);
		});
	});
}

$(document).ready(function() {
	console.log("ready");

	$("#pic").load(function() {
		if(curr) {
			$("#picList").focus();
			$("#page").scrollTop($("#" + curr.id).attr("vpos"));
			console.log('restore vpos: ' + $("#" + curr.id).attr("vpos"));
		}
		origWidth = $('#pic').prop('naturalWidth');
		setScale();
	});
	
	if(typeof enableNetwork == 'function')
		enableNetwork();
		
	bindHotkey();
	bindAnimate();
	bindSort();
	setWindow();
	readConfig();
});

