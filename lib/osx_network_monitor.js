/**
* This script was developed by Guberni and is part of Tellki's Monitoring Solution
*
* June, 2015
* 
* Version 1.0
*
* DESCRIPTION: Monitor OSX Network
*
* SYNTAX: node osx_network_monitor.js <METRIC_STATE>
* 
* EXAMPLE: node osx_network_monitor.js "1,1,1,1,1,1,1,1"
*
* README:
*       <METRIC_STATE> is generated internally by Tellki and it's only used by Tellki default monitors.
*       1 - metric is on ; 0 - metric is off
**/

var fs = require('fs');

// METRICS

var metrics = [];
metrics['Ipkts'] =  { retrieveMetric: 1, id: '2128:Packets In:4',           ratio: 2, get: function(t){return t[4];} }; // Ratio: 1=MB/s, 2=Count/s
metrics['Ierrs'] =  { retrieveMetric: 1, id: '2130:Errors In:4',            ratio: 2, get: function(t){return t[5];} };
metrics['Ibytes'] = { retrieveMetric: 1, id: '2126:MB In/s:4',              ratio: 1, get: function(t){return t[6];} };
metrics['Opkts'] =  { retrieveMetric: 1, id: '2129:Packets Out:4',          ratio: 2, get: function(t){return t[7];} };
metrics['Oerrs'] =  { retrieveMetric: 1, id: '2131:Errors Out:4',           ratio: 2, get: function(t){return t[8];} };
metrics['Obytes'] = { retrieveMetric: 1, id: '2127:MB Out/s:4',             ratio: 1, get: function(t){return t[9];} };
metrics['Coll'] =   { retrieveMetric: 1, id: '2132:Packet Collisions:4',    ratio: 2, get: function(t){return t[10];} };
metrics['Drop'] =   { retrieveMetric: 1, id: '2133:Packet Drops:4',         ratio: 2, get: function(t){return t[11];} };

var tempDir = '/tmp';
var sleepTime = 1000;

// ############# INPUT ###################################

//START
(function() {
    try
    {
        monitorInputProcess(process.argv.slice(2));
    }
    catch(err)
    {   
        console.log(err.message);
        process.exit(1);

    }
}).call(this)

/**
 * Process the passed arguments and send them to monitor execution
 * Receive: arguments to be processed
 */
function monitorInputProcess(args)
{
    if (args[0] != undefined)
    {
        //<METRIC_STATE>
        var metricState = args[0].replace(/\"/g, '');
        var tokens = metricState.split(",");

        if (tokens.length != Object.keys(metrics).length)
            throw new Error("Invalid number of metric state");

        var i = 0;
        for (var key in metrics) 
        {
            if (metrics.hasOwnProperty(key)) 
            {
                metrics[key].retrieveMetric = parseInt(tokens[i]);
                i++;
            }
        }
    }

    monitor();
    
}

// PROCESS

/**
 * Retrieve metrics information
 */
function monitor()
{
    var process = require('child_process');
     
    var ls = process.exec('netstat -nbid', function (error, stdout, stderr) {
        if (error)
            errorHandler(new UnableToGetMetricsError(stderr));

        parseResult(stdout.trim());           
    });
        
    ls.on('exit', function (code) {
		if (code === 127)
	   		errorHandler(new UnableToGetMetricsError('Command \'netstat\' not found.'));
		else if (code !== 0)
			errorHandler(new UnableToGetMetricsError());
    });
}

/*
* Parse result from process output
* Receive: string containing results
*/
function parseResult(result)
{
    var lines = result.split('\n');

    var jsonString = "[";
    var dateTime = new Date().toISOString();

    for(var i in lines)
    {
        if(lines[i].indexOf("Link#") == -1)
        {
            continue;
        }   
        else
        {
            var tokens = lines[i].replace(/\s+/g, ' ').split(' ');
            if (tokens.length === 11 || tokens.length === 12)
            {
                if (tokens.length === 11)
                {
                    tokens.splice(3, 0, '');
                }

                if (tokens[4] > 0)
                {
                    var interfaceName = tokens[0];

                    for (var metricName in metrics)
                    {
                        var metric = metrics[metricName];

                        jsonString += "{";
                                        
                        jsonString += "\"variableName\":\""+metricName+"\",";
                        jsonString += "\"metricUUID\":\""+metric.id+"\",";
                        jsonString += "\"timestamp\":\""+ dateTime +"\",";
                        jsonString += "\"value\":\""+ metric.get(tokens) +"\",";
                        jsonString += "\"object\":\""+ interfaceName +"\"";
                        
                        jsonString += "},";
                    }
                }
            }
        }
    }

    if(jsonString.length > 1)
        jsonString = jsonString.slice(0, jsonString.length - 1);
            
    jsonString += "]";

    processDeltas(jsonString);
}



//################### OUTPUT METRICS ###########################

/*
* Send metrics to console
*/
function output(toOutput)
{
    for (var i in toOutput) 
    {
        var metricToOutput = toOutput[i];

        if (metrics.hasOwnProperty(metricToOutput.variableName)) 
        {
            if(metrics[metricToOutput.variableName].retrieveMetric === 1)
            {
                var out = "";
                
                out += metricToOutput.id + '|';
                out += metricToOutput.value + '|';
                out += metricToOutput.object + '|';
                
                console.log(out);
            }
        }
    }
}



// ##################### UTILS #####################
/*
* Process performance results
* Receive: 
* - request object containing configuration
* - retrived results
*/
function processDeltas(results)
{
    var file = getFile();
    var toOutput = [];
    
    if (file)
    {       
        var previousData = JSON.parse(file);
        var newData = JSON.parse(results);
            
        for (var i = 0; i < newData.length; i++)
        {
            var endMetric = newData[i];
            var initMetric = null;
            
            for (var j = 0; j < previousData.length; j++)
            {
                if (previousData[j].metricUUID === newData[i].metricUUID && previousData[j].object === newData[i].object)
                {
                    initMetric = previousData[j];
                    break;
                }
            }
            
            if (initMetric != null)
            {
                var deltaValue = getDelta(initMetric, endMetric);
                
                var rateMetric = new Object();
                rateMetric.variableName = endMetric.variableName;
                rateMetric.id = endMetric.metricUUID;
                rateMetric.timestamp = endMetric.timestamp;
                rateMetric.value = deltaValue;
                rateMetric.object = endMetric.object;
                
                toOutput.push(rateMetric);
            }
            else
            {   
                var rateMetric = new Object();
                rateMetric.variableName = endMetric.variableName;
                rateMetric.id = endMetric.metricUUID;
                rateMetric.timestamp = endMetric.timestamp;
                rateMetric.value = 0;
                rateMetric.object = endMetric.object;
                
                toOutput.push(rateMetric);
            }
        }
        
        setFile(results);

        for (var m = 0; m < toOutput.length; m++)
        {
            for (var z = 0; z < newData.length; z++)
            {
                var systemMetric = metrics[newData[z].variableName];
                
                if (systemMetric.ratio === false && newData[z].metricUUID === toOutput[m].id && newData[z].object === toOutput[m].object)
                {
                    toOutput[m].value = newData[z].value;
                    break;
                }
            }
        }

        output(toOutput);
    }
    else
    {
        setFile(results);

        // Execute again.
        setTimeout(function() {
            monitorInputProcess(process.argv.slice(2));
        }, sleepTime);
    }
}


/*
* Calculate ratio metric's value
* Receive: 
* - previous value
* - current value
* - 
*/
function getDelta(initMetric, endMetric)
{
    var deltaValue = 0;
    var decimalPlaces = 2;

    var date = new Date().toISOString();
    
    if (parseFloat(endMetric.value) < parseFloat(initMetric.value))
    {   
        deltaValue = parseFloat(endMetric.value).toFixed(decimalPlaces);
    }
    else
    {   
        if (metrics[initMetric.variableName].ratio === 1)
        {
            var elapsedTime = (new Date(endMetric.timestamp).getTime() - new Date(initMetric.timestamp).getTime()) / 1000;
            deltaValue = ((parseFloat(endMetric.value) - parseFloat(initMetric.value))/elapsedTime).toFixed(decimalPlaces);
        }
        else if (metrics[initMetric.variableName].ratio === 2)
        {
            deltaValue = (parseFloat(endMetric.value) - parseFloat(initMetric.value)).toFixed(decimalPlaces);
        }
    }
    
    return deltaValue;
}

/*
* Get last results if any saved
*/
function getFile()
{
    var dirPath =  __dirname +  tempDir + "/";
    var filePath = dirPath + ".osx_network.dat";
    
    try
    {
        fs.readdirSync(dirPath);
        
        var file = fs.readFileSync(filePath, 'utf8');
        
        if (file.toString('utf8').trim())
        {
            return file.toString('utf8').trim();
        }
        else
        {
            return null;
        }
    }
    catch(e)
    {
        return null;
    }
}



/*
* Save current metrics values to be used to calculate ratios on next runs
* Receive: 
* - retrieved result
*/
function setFile(json)
{
    var dirPath =  __dirname +  tempDir + "/";
    var filePath = dirPath + ".osx_network.dat";
        
    if (!fs.existsSync(dirPath)) 
    {
        try
        {
            fs.mkdirSync( __dirname+tempDir);
        }
        catch(e)
        {
            var ex = new CreateTmpDirError(e.message);
            ex.message = e.message;
            errorHandler(ex);
        }
    }

    try
    {
        fs.writeFileSync(filePath, json);
    }
    catch(err)
    {
        var ex = new WriteOnTmpFileError(e.message);
        ex.message = err.message;
        errorHandler(ex);
    }
}

//################### ERROR HANDLER #########################
/*
* Used to handle errors of async functions
* Receive: Error/Exception
*/
function errorHandler(err)
{
    if(err instanceof UnableToGetMetricsError)
    {
        console.log(err.message);
        process.exit(err.code);
    }
    else if(err instanceof CreateTmpDirError)
    {
        console.log(err.message);
        process.exit(err.code);
    }
    else if(err instanceof WriteOnTmpFileError)
    {
        console.log(err.message);
        process.exit(err.code);
    }
    else
    {
        console.log(err.message);
        process.exit(1);
    }
}


//####################### EXCEPTIONS ################################

//All exceptions used in script

function UnableToGetMetricsError(msg) {
    this.name = 'UnableToGetMetricsError';
    this.message = (msg === undefined) ? 'Unable to get metrics' : msg;
    this.code = 31;
}
UnableToGetMetricsError.prototype = Object.create(Error.prototype);
UnableToGetMetricsError.prototype.constructor = UnableToGetMetricsError;


function CreateTmpDirError()
{
    this.name = 'CreateTmpDirError';
    this.message = '';
    this.code = 21;
}
CreateTmpDirError.prototype = Object.create(Error.prototype);
CreateTmpDirError.prototype.constructor = CreateTmpDirError;


function WriteOnTmpFileError()
{
    this.name = 'WriteOnTmpFileError';
    this.message = '';
    this.code = 22;
}
WriteOnTmpFileError.prototype = Object.create(Error.prototype);
WriteOnTmpFileError.prototype.constructor = WriteOnTmpFileError;
