var express = require('express'),
  config = require('./config/config'),
  glob = require('glob'),
  Contribuyente = require('./app/models/contribuyente'),
  mongoose = require('mongoose'),
  unzip = require('unzip'),
  moment = require('moment'),
  CronJob = require('cron').CronJob;

var fs = require('fs'),
  url = require('url'),
  http = require('http'),
  exec = require('child_process').exec,
  spawn = require('child_process').spawn;


mongoose.connect(config.db);
var db = mongoose.connection;
db.on('error', function() {
  throw new Error('unable to connect to database at ' + config.db);
});

var models = glob.sync(config.root + '/app/models/*.js');
models.forEach(function(model) {
  require(model);
});
var app = express();

require('./config/express')(app, config);




var file_url = 'http://www.afip.gob.ar/genericos/cInscripcion/archivos/SINapellidoNombreDenominacion.zip';
var DOWNLOAD_DIR = './downloads/';
var DOWNLOADED_FILE = DOWNLOAD_DIR + 'utlfile/padr/SELE-SAL-CONSTA.p20out2.20160409.tmp';

// We will be downloading the files to a directory, so make sure it's there
// This step is not required if you have manually created the directory
var mkdir = 'mkdir -p ' + DOWNLOAD_DIR;
var child = exec(mkdir, function(err, stdout, stderr) {
  if (err) throw err;
  else download_file_httpget(file_url);
});

// Function to download file using HTTP.get
var download_file_httpget = function(file_url) {
  var options = {
    host: url.parse(file_url).host,
    port: 80,
    path: url.parse(file_url).pathname
  };

  var file_name = url.parse(file_url).pathname.split('/').pop();
  var file = fs.createWriteStream(DOWNLOAD_DIR + file_name);

  http.get(options, function(res) {
    res.on('data', function(data) {
      file.write(data);
    }).on('end', function() {
      file.end();
      console.log(file_name + ' downloaded to ' + DOWNLOAD_DIR);

      fs.createReadStream(DOWNLOAD_DIR + file_name)
        .pipe(unzip.Extract({
          path: DOWNLOAD_DIR
        }));

      var input = fs.createReadStream(DOWNLOADED_FILE);
      readLines(input, func);

    });
  });
};



app.listen(config.port, function() {
  console.log('Express server listening on port ' + config.port);

  // new CronJob('* * * * * *', function() {
  //   console.log('You will see this message every second');
  // }, null, true, 'America/Los_Angeles');

  download_file_httpget(file_url);

});



function readLines(input, func) {
  var remaining = '';

  input.on('data', function(data) {
    remaining += data;
    var index = remaining.indexOf('\n');
    while (index > -1) {
      var line = remaining.substring(0, index);
      remaining = remaining.substring(index + 1);
      func(line);
      index = remaining.indexOf('\n');
    }
  });

  input.on('end', function() {
    if (remaining.length > 0) {
      func(remaining);
    }
  });
}

function func(data) {
  console.log('Line: ' + data);

  var contribuyente = new Contribuyente({
    cuit: data.slice(0, 11),
    impGanancias: data.slice(11, 13),
    impIva: data.slice(13, 15),
    monotributo: data.slice(15, 17),
    integranteSoc: data.slice(17, 18),
    empleador: data.slice(18, 19),
    actMonotributo: data.slice(19, 21)
  });
  contribuyente.save(function(err) {
    if (err) {
      return err;
    } else {
      console.log("contribuyente saved");
    }
  });

}
