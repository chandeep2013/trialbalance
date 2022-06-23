const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const axios = require('axios');
const cfenv = require('cfenv');
const appEnv = cfenv.getAppEnv();
const xsenv = require('@sap/xsenv');
xsenv.loadEnv();
const services = xsenv.getServices({
    uaa: {
        tag: 'xsuaa'
    },
    registry: {
        tag: 'SaaS'
    },
    dest: {
        tag: 'destination'
    },
    connectivity: {
        tag: 'connectivity'
    }
});
const core = require('@sap-cloud-sdk/core');
const {
    retrieveJwt
} = require('@sap-cloud-sdk/core');

const xssec = require('@sap/xssec');
const passport = require('passport');
passport.use('JWT', new xssec.JWTStrategy(services.uaa));
app.use(passport.initialize());
app.use(passport.authenticate('JWT', {
    session: false
}));
app.use(bodyParser.json());
const lib = require('./library');

///// ------ Applicaiton Logging service ------/////
const log= require('cf-nodejs-logging-support');
log.setLoggingLevel('info');
log.registerCustomFields(["Subdomain","UserName","JWT","DestinationConfig","LedgerError","CompanyCodeError","TrialBalanceError","CompanyCodeDetailsError","PostTrialBalanceError","PostMasterDataError"]);
app.use(log.logNetwork);

/////-------------------------- Start of changes ------------------------------////////////////
const sS4HanaDestName = 'OTPS4HANA';
const sCpiDestName = 'OTPCPI';

const dest_service = xsenv.getServices({
    dest: {
        tag: 'destination'
    }
}).dest;
const uaa_service = xsenv.getServices({
    uaa: {
        tag: 'xsuaa'
    }
}).uaa;
const connectivity_service = xsenv.getServices({ //// get connectivity service for on premise
    connectivity: {
        tag: 'connectivity'
    }
}).connectivity;

var destJwtToken = ""; // Destination Jwt token
var connJwtToken = ""; // connectivity Jwt token
var oSystem = ""; // flag for cpi 

app.get('/srv/info', function(req, res) {
    if (req.authInfo.checkScope('uaa.user')) {
        let info = {
            'userInfo': req.user,
            'subdomain': req.authInfo.getSubdomain(),
            'tenantId': req.authInfo.getZoneId(),
            'scope': req.tokenInfo.getPayload().scope,
            'origin': req.tokenInfo.getPayload().origin,
            'tokenInfo': req.tokenInfo.getPayload()
        };
        res.status(200).json(info);
    } else {
        res.status(403).send('Forbidden');
    }
});
////--------------- Fetch JWT Token ----------------//////////////
const fetchTokenHandler = async function(subdomain, oauthUrl, oauthClient, oauthSecret) {
    return new Promise((resolve, reject) => {
        const tokenUrl = oauthUrl.split('://')[0] + '://' + subdomain + oauthUrl.slice(oauthUrl.indexOf('.')) + '/oauth/token?grant_type=client_credentials';
        const config = {
            headers: {
                Authorization: "Basic " + Buffer.from(oauthClient + ':' + oauthSecret).toString("base64")
            }
        }
        axios.get(tokenUrl, config)
            .then(response => {
                resolve(response.data.access_token)
            })
            .catch(error => {
                console.log("error jwt", error)
                req.logger.info('JWT Token Error===>',{"JWT": error});
                reject(error)
            })
    })
}
/////------------------- Get Token -------------- /////////////
app.get('/srv/getToken', async function(req, res) {

    destJwtToken = await fetchTokenHandler(req.authInfo.getSubdomain(), dest_service.url, dest_service.clientid, dest_service.clientsecret);
    connJwtToken = await fetchTokenHandler(req.authInfo.getSubdomain(), connectivity_service.token_service_url, connectivity_service.clientid, connectivity_service.clientsecret);
    req.logger.info('User==>',{"UserName": req.user}); //-------- Adding User details in Logging service  
    req.logger.info('Subdomain===>',{"Subdomain": req.authInfo.getSubdomain()});//-------- Adding Subdomain in Logging service  
    return res.type("application/json").status(200).send({
        data: destJwtToken
    });
});
/////--------------- Token Validity Check -------------------////////////
const tokenValidityCheck = (bearerHeader) => {
    if (typeof bearerHeader !== 'undefined') {
        const bearer = bearerHeader.split(' ');
        const bearerToken = bearer[1];
        var jwtToken = bearerToken;
        const payloadBase64 = jwtToken.split('.')[1];
        const decodedJson = Buffer.from(payloadBase64, 'base64').toString();
        const decoded = JSON.parse(decodedJson);
        const exp = decoded.exp;
        const expired = (Date.now() >= exp * 1000);
        return expired;
    } else {
        res.sendStatus(403);
    }
}
////--------- Call Destination Service. Result will be an object with Destination Configuration info----/////
const _readDestinationConfig = async function(destinationName, destUri, jwtToken) {
    var configHeaders = "";
    var configProxy = "";
    return new Promise((resolve, reject) => {
        const destSrvUrl = destUri + '/destination-configuration/v1/destinations/' + destinationName
        const config = {
            headers: {
                Authorization: 'Bearer ' + jwtToken
            }
        }
        axios.get(destSrvUrl, config)
            .then(response => {
                const token = response.data.authTokens[0];
                let destConfig = response.data.destinationConfiguration;
                ////------- conditions for OnPremise/Cloud-------//////
                if (destConfig.ProxyType === "OnPremise") {
                    oSystem = "S4HANAOnPremise";
                    configHeaders = { //// headers for on premise system
                        'Authorization': `${token.type} ${token.value}`,
                        'Proxy-Authorization': 'Bearer ' + connJwtToken,
                        'SAP-Connectivity-SCC-Location_ID': destConfig.CloudConnectorLocationId
                    }
                    configProxy = { ///// proxy for on premise system
                        host: connectivity_service.onpremise_proxy_host,
                        port: connectivity_service.onpremise_proxy_http_port
                    }
                } else {
                    oSystem = "S4HANACloud";
                    configHeaders = { //// headers for cloud system
                        "Accept": "application/json",
                        "content-type": "application/json",
                        'Authorization': `${token.type} ${token.value}`
                    }
                }
                ////------ return destination info ----////
                let oDestConfigInfo = {
                    "destConfig": destConfig,
                    "configHeaders": configHeaders,
                    "configProxy": configProxy
                };
                resolve(oDestConfigInfo)
            })
            .catch(error => {
                console.log("destinationConfigurationError", error);
                req.logger.info('Destination Config Error===>',{"DestinationConfig": error});
                reject(error)
            })
    })
}
//////--------------------Selection service calls-------------------////////////////////////////
/////-------------------- Get Ledger From S/4 System ---------------////////////////////////////
app.post('/srv/getLedger', async (req, res) => {
    var token = req.body.token;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        fetchTokenHandler(req.authInfo.getSubdomain(), dest_service.url, dest_service.clientid, dest_service.clientsecret).then(
            (response) => getLedger(response.data).then(
                (ledgerRes) => {
                    return res.type("application/json").status(ledgerRes.statusCode).send({
                        results: ledgerRes.result
                    });
                }
            )
        )
    } else {
        getLedger(token).then(
            (ledgerRes) => {
                //-------- Adding Ledger Service Call Error in Logging service 
                if(parseInt(ledgerRes.statusCode) > 203){
                    req.logger.info('Ledger Service Call Error===>',{"LedgerError": ledgerRes.result});
                }
                return res.type("application/json").status(ledgerRes.statusCode).send({
                    results: ledgerRes.result
                });
            }
        );
    }
});
/////////---------- Get Ledger Function call ----------////////////////
const getLedger = async (token) => {
    const oDestConfigInfo = await _readDestinationConfig(sS4HanaDestName, dest_service.uri, token);
    var ledgerRes = {};
    return axios({
        method: 'GET',
        url: oDestConfigInfo.destConfig.URL + "/sap/opu/odata/sap/C_TRIALBALANCE_CDS/Ledger",
        headers: oDestConfigInfo.configHeaders,
        proxy: oDestConfigInfo.configProxy
    }).then(function(result) {
        ledgerRes.statusCode = 202;
        ledgerRes.result = result.data.d;
        //console.log("ledgerRes====>>>",ledgerRes);
        return ledgerRes;
    }).catch(function(error) {
        console.log("LedgerService Call failed===>>>> error", error);
        ledgerRes.statusCode = error.response.status;
        ledgerRes.result = error.response.data;
        return ledgerRes;
    });
}

/////-------------------- Get CompanyCode From S/4 System ---------------////////////////////////////
app.post('/srv/getCompanyCode', async (req, res) => {
    var token = req.body.token;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        fetchTokenHandler(req.authInfo.getSubdomain(), dest_service.url, dest_service.clientid, dest_service.clientsecret).then(
            (response) => getCompanyCode(response.data).then(
                (companyCodeRes) => {
                    return res.type("application/json").status(companyCodeRes.statusCode).send({
                        results: companyCodeRes.result
                    });
                }
            )
        )
    } else {
        getCompanyCode(token).then(
            (companyCodeRes) => {
                //-------- Adding CompanyCode Service Call Error in Logging service 
                if(parseInt(companyCodeRes.statusCode) > 203){
                    req.logger.info('companyCode Service Call Error===>',{"CompanyCodeError": companyCodeRes.result});
                }
                return res.type("application/json").status(companyCodeRes.statusCode).send({
                    results: companyCodeRes.result
                });
            }
        );
    }
});
/////--------------- Get Company code Funciton call --------------//////////////
const getCompanyCode = async (token) => {
    var companyCodeRes = {};
    const oDestConfigInfo = await _readDestinationConfig(sS4HanaDestName, dest_service.uri, token);
    return axios({
        method: 'GET',
        url: oDestConfigInfo.destConfig.URL + "/sap/opu/odata/sap/C_TRIALBALANCE_CDS/CompanyCode",
        headers: oDestConfigInfo.configHeaders,
        proxy: oDestConfigInfo.configProxy
    }).then(function(result) {
        companyCodeRes.statusCode = 202;
        companyCodeRes.result = result.data.d;
        //console.log("companyCodeRes====>>>",companyCodeRes);
        return companyCodeRes;
    }).catch(function(error) {
        console.log("companyCodeRes Call failed===>>>> error", error);
        companyCodeRes.statusCode = error.response.status;
        companyCodeRes.result = error.response.data;
        return companyCodeRes;
    });
}
/////-------------------- Get Trial Balance Data From S/4 System ---------------////////////////////////////
app.post('/srv/getTrialBalanceData', async (req, res) => {
    const token = req.body.token;
    var spath = req.body.sPath;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        //console.log("Checking with expired token=====>>", expired);re.authInfo.getSubdomain();
        fetchTokenHandler(req.authInfo.getSubdomain(), dest_service.url, dest_service.clientid, dest_service.clientsecret).then(
            (response) => getTrialBalanceData(response.data, spath).then(
                (trialBalanceRes) => {
                    return res.type("application/json").status(trialBalanceRes.statusCode).send({
                        results: trialBalanceRes.result
                    });
                }
            )
        )
    } else {
        getTrialBalanceData(token, spath).then(
            (trialBalanceRes) => {
                //-------- Adding TrialBalance Service Call Error in Logging service 
                if(parseInt(trialBalanceRes.statusCode) > 203){
                    req.logger.info('TrialBalance Service Call Error===>',{"TrialBalanceError": trialBalanceRes.result});
                }
                return res.type("application/json").status(trialBalanceRes.statusCode).send({
                    results: trialBalanceRes.result
                });
            }
        );
    }
});
/////----------- get trial balance data function call --------////////////////////
const getTrialBalanceData = async (token, spath) => {
    var trialBalanceRes = {};
    const oDestConfigInfo = await _readDestinationConfig(sS4HanaDestName, dest_service.uri, token);
    return axios({
        method: 'GET',
        url: oDestConfigInfo.destConfig.URL + spath,
        headers: oDestConfigInfo.configHeaders,
        proxy: oDestConfigInfo.configProxy
    }).then(function(result) {
        trialBalanceRes.statusCode = 202;
        trialBalanceRes.result = result.data.d;
        //console.log("trialBalanceRes====>>>",trialBalanceRes);
        return trialBalanceRes;
    }).catch(function(error) {
        console.log("trialBalanceRes Call failed===>>>> error", error);
        trialBalanceRes.statusCode = error.response.status;
        trialBalanceRes.result = error.response.data;
        return trialBalanceRes;
    });
}
/////-------------------- Get CompnayCode Data From S/4 System ---------------////////////////////////////
app.post('/srv/getCompanyCodeData', async (req, res) => {
    const token = req.body.token;
    var spath = req.body.sPath;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        fetchTokenHandler(req.authInfo.getSubdomain(), dest_service.url, dest_service.clientid, dest_service.clientsecret).then(
            (response) => getCompanyCodeData(response.data, spath).then(
                (companyCodeDataRes) => {
                    return res.type("application/json").status(companyCodeDataRes.statusCode).send({
                        results: companyCodeDataRes.result
                    });
                }
            )
        )
    } else {
        getCompanyCodeData(token, spath).then(
            (companyCodeDataRes) => {
                //-------- Adding CompanyCodeDetails Service Call Error in Logging service 
                if(parseInt(companyCodeDataRes.statusCode) > 203){
                    req.logger.info('CompanyCodeDetails Service Call Error===>',{"CompanyCodeDetailsError": companyCodeDataRes.result});
                }
                return res.type("application/json").status(companyCodeDataRes.statusCode).send({
                    results: companyCodeDataRes.result
                });
            }
        );
    }
});
//////////////----------- get company code data function call --------////////////////////
const getCompanyCodeData = async (token, spath) => {
    var companyCodeDataRes = {};
    const oDestConfigInfo = await _readDestinationConfig(sS4HanaDestName, dest_service.uri, token);
    return axios({
        method: 'GET',
        url: oDestConfigInfo.destConfig.URL + spath,
        headers: oDestConfigInfo.configHeaders,
        proxy: oDestConfigInfo.configProxy
    }).then(function(result) {
        companyCodeDataRes.statusCode = 202;
        companyCodeDataRes.result = result.data.d;
        //console.log("companyCodeDataRes====>>>",companyCodeDataRes);
        return companyCodeDataRes;
    }).catch(function(error) {
        console.log("companyCodeDataRes Call failed===>>>> error", error);
        companyCodeDataRes.statusCode = error.response.status;
        companyCodeDataRes.result = error.response.data;
        return companyCodeDataRes;
    });
}

/////-------------------- Post Trial Blance Data to OTP ---------------////////////////////////////
app.post('/srv/PostTrialbalanceData', (req, res) => {
    const token = req.body.token;
    const reqInput = req.body;
    const subdomain = req.authInfo.getSubdomain();
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        fetchTokenHandler(subdomain).then(
            (response) => postTrialBalanceData(response.data, subdomain, reqInput).then(
                (postTrialBalanceRes) => {
                    return res.type("application/json").status(postTrialBalanceRes.statusCode).send({
                        response: postTrialBalanceRes.response
                    });
                }
            )
        )
    } else {
        postTrialBalanceData(token, subdomain, reqInput).then(
            (postTrialBalanceRes) => {
                //-------- Adding PostTrialBalance Service Call Error in Logging service 
                if(parseInt(postTrialBalanceRes.statusCode) > 203){
                    req.logger.info('PostTrialBalance Service Call Error===>',{"PostTrialBalanceError": postTrialBalanceRes.response});
                }
                return res.type("application/json").status(postTrialBalanceRes.statusCode).send({
                    response: postTrialBalanceRes.response
                });
            }
        );
    }
});
/////----------- post trial balance data function call --------////////////////////
const postTrialBalanceData = (token, subdomain, reqInput) => {
    var postTrialBalanceRes = {};
    return axios({
        method: 'GET',
        url: dest_service.uri + '/destination-configuration/v1/destinations/' + sCpiDestName,
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(function(destData) {
        const oDestination = destData;
        const token = oDestination.data.authTokens[0];
        return axios({
            url: oDestination.data.destinationConfiguration.URL + '/http/CPI/PushTrialBalance/V1.0',
            withCredentials: true,
            resolveWithFullResponse: true,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "X-CSRF-Token": "Fetch",
                'Authorization': `${token.type} ${token.value}`
            }
        }).then(function(response) {
            return axios({
                method: 'POST',
                url: oDestination.data.destinationConfiguration.URL + '/http/CPI/PushTrialBalance/V1.0',
                resolveWithFullResponse: true,
                headers: {
                    "content-type": "application/json",
                    "accept": "application/json",
                    "x-csrf-token": Object.getOwnPropertyDescriptor(response.headers, 'x-csrf-token').value,
                    "Cookie": Object.getOwnPropertyDescriptor(response.headers, 'set-cookie').value,
                    "Content-Type": "application/json; charset=utf-8",
                    "FromDate": reqInput.fromDate + "T00:00:00",
                    "ToDate": reqInput.ToDate + "T00:00:00",
                    "filter": reqInput.filter,
                    "select": "CompanyCode,GLAccount,GLAccountHierarchyName,ChartOfAccounts,StartingBalanceAmtInCoCodeCrcy,DebitAmountInCoCodeCrcy,CreditAmountInCoCodeCrcy,EndingBalanceAmtInCoCodeCrcy,CompanyCodeCurrency,ProfitCenter,CostCenter",
                    "format": "json",
                    "TenantID": subdomain.toUpperCase(),
                    withCredentials: true,
                    "System": oSystem,
                    'Authorization': `${token.type} ${token.value}`
                }
            }).then(function(response) {
                //console.log("***Response From post trialbalnce API post call*********" + response.data);
                postTrialBalanceRes.statusCode = '201';
                postTrialBalanceRes.response = response.data;
                return postTrialBalanceRes;
            }).catch(function(error) {
                console.log("postTrialBalanceDataService Call failed===>> error", error);
                postTrialBalanceRes.statusCode = error.response.status;
                postTrialBalanceRes.response = error.response.data;
                return postTrialBalanceRes;
            });
        }).catch(function(error) {
            console.log("postTrialBalanceDataService Call failed===>> error", error);
            postTrialBalanceRes.statusCode = error.response.status;
            postTrialBalanceRes.response = error.response.data;
            return postTrialBalanceRes;
        });
    }).catch(function(error) {
        console.log("Post trial balance Failed to authenticate token ====>>>>", error);
        postTrialBalanceRes.statusCode = error.response.status;
        postTrialBalanceRes.response = error.response.data;
        return postTrialBalanceRes;
        //return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
    });
}
/////-------------------- Post Master Data to OTP ---------------////////////////////////////
app.post('/srv/PostCOAMasterData', (req, res) => {
    const token = req.body.reqbody.token;
    const reqInput = req.body;
    const subdomain = req.authInfo.getSubdomain();
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        fetchTokenHandler(req.authInfo.getSubdomain(), dest_service.url, dest_service.clientid, dest_service.clientsecret).then(
            (response) => postMasterData(response.data, subdomain, reqInput).then(
                (postMasterDataRes) => {
                    return res.type("application/json").status(postMasterDataRes.statusCode).send({
                        response: postMasterDataRes.response
                    });
                }
            )
        )
    } else {
        postMasterData(token, subdomain, reqInput).then(
            (postMasterDataRes) => {
                //-------- Adding PostMasterData Service Call Error in Logging service 
                if(parseInt(postMasterDataRes.statusCode) > 203){
                    req.logger.info('PostMasterData Service Call Error===>',{"PostMasterDataError": postMasterDataRes.response});
                }
                return res.type("application/json").status(postMasterDataRes.statusCode).send({
                    response: postMasterDataRes.response
                });
            }
        );
    }
});
/////----------- post master data function call --------////////////////////
const postMasterData = (token, subdomain, reqInput) => {
    var postMasterDataRes = {};
    return axios({
        method: 'GET',
        url: dest_service.uri + '/destination-configuration/v1/destinations/' + sCpiDestName,
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(function(destData) {
        const oDestination = destData;
        const token = oDestination.data.authTokens[0];
        return axios({
            url: oDestination.data.destinationConfiguration.URL + '/http/CPI/FetchMasterData/MasterDataUpdate/V9.0',
            withCredentials: true,
            resolveWithFullResponse: true,
            headers: {
                "content-type": "application/json",
                "accept": "application/json",
                "X-CSRF-Token": "Fetch",
                'Authorization': `${token.type} ${token.value}`
            }
        }).then(function(response) {
            return axios({
                method: 'POST',
                url: oDestination.data.destinationConfiguration.URL + '/http/CPI/FetchMasterData/MasterDataUpdate/V9.0',
                resolveWithFullResponse: true,
                data: JSON.stringify(reqInput.companycodeData),
                headers: {
                    "content-type": "application/json",
                    "accept": "application/json",
                    "x-csrf-token": Object.getOwnPropertyDescriptor(response.headers, 'x-csrf-token').value,
                    "Cookie": Object.getOwnPropertyDescriptor(response.headers, 'set-cookie').value,
                    "Content-Type": "application/json; charset=utf-8",
                    "FromDate": reqInput.reqbody.fromDate + "T00:00:00",
                    "ToDate": reqInput.reqbody.ToDate + "T00:00:00",
                    "filter": reqInput.reqbody.filter,
                    "select": "CompanyCode,GLAccount,GLAccountHierarchyName,ChartOfAccounts,StartingBalanceAmtInCoCodeCrcy,DebitAmountInCoCodeCrcy,CreditAmountInCoCodeCrcy,EndingBalanceAmtInCoCodeCrcy,CompanyCodeCurrency,ProfitCenter,CostCenter",
                    "format": "json",
                    "TenantID": subdomain.toUpperCase(),
                    withCredentials: true,
                    "System": oSystem,
                    'Authorization': `${token.type} ${token.value}`
                }
            }).then(function(response) {
                //console.log("***Response From post MasterData API post call*********" + response.data);
                postMasterDataRes.statusCode = '201';
                postMasterDataRes.response = response.data;
                return postMasterDataRes;
            }).catch(function(error) {
                console.log("postMasterData Call failed===>> error", error);
                postMasterDataRes.statusCode = error.response.status;
                postMasterDataRes.response = error.response.data;
                return postMasterDataRes;

            });
        }).catch(function(error) {
            console.log("postMasterData Call failed on getting x-csrf-token ===>> error", error);
            postMasterDataRes.statusCode = error.response.status;
            postMasterDataRes.response = error.response.data;
            return postMasterDataRes;
        });
    }).catch(function(error) {
        console.log("Failed to authenticate token ====>>>>", error);
        postMasterDataRes.statusCode = error.response.status;
        postMasterDataRes.response = error.response.data;
        return postMasterDataRes;
        //return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
    });
}
////////--------------------------------- End of changes ----------------------------/////////////////
// subscribe/onboard a subscriber tenant
app.put('/callback/v1.0/tenants/*', function(req, res) {
    let tenantHost = req.body.subscribedSubdomain + '-' + appEnv.app.space_name.toLowerCase().replace(/_/g, '-') + '-' + services.registry.appName.toLowerCase().replace(/_/g, '-');
    let tenantURL = 'https:\/\/' + tenantHost + /\.(.*)/gm.exec(appEnv.app.application_uris[0])[0];
    // console.log('Subscribe: ', req.body.subscribedSubdomain, req.body.subscribedTenantId, tenantHost, tenantURL);
    // Veracode - removing consoles
    lib.createRoute(tenantHost, services.registry.appName).then(
        function(result) {
            res.status(200).send(tenantURL);
        },
        function(err) {
            console.log(err.stack);
            res.status(500).send(err.message);
        });
});

// unsubscribe/offboard a subscriber tenant
app.delete('/callback/v1.0/tenants/*', function(req, res) {
    let tenantHost = req.body.subscribedSubdomain + '-' + appEnv.app.space_name.toLowerCase().replace(/_/g, '-') + '-' + services.registry.appName.toLowerCase().replace(/_/g, '-');
    //console.log('Unsubscribe: ', req.body.subscribedSubdomain, req.body.subscribedTenantId, tenantHost);
    // Veracode - removing consoles
    lib.deleteRoute(tenantHost, services.registry.appName).then(
        function(result) {
            res.status(200).send('');
        },
        function(err) {
            console.log(err.stack);
            res.status(500).send(err.message);
        });
});

// get reuse service dependencies
app.get('/callback/v1.0/dependencies', function(req, res) {
    let tenantId = req.params.tenantId;
    let dependencies = [{
        'xsappname': services.dest.xsappname
    }, {
        'xsappname': services.connectivity.xsappname ///// -- ---- connectivity service added for onPremise---////
    }];
    //console.log('Dependencies: ', tenantId, dependencies);
    // Veracode - removing consoles
    res.status(200).json(dependencies);
});

// app subscriptions
app.get('/srv/subscriptions', function(req, res) {
    if (req.authInfo.checkScope('$XSAPPNAME.Administrator')) {
        lib.getSubscriptions(services.registry).then(
            function(result) {
                res.status(200).json(result);
            },
            function(err) {
                console.log(err.stack);
                res.status(500).send(err.message);
            });
    } else {
        res.status(403).send('Forbidden');
    }
});
// destination reuse service
app.get('/srv/destinations', async function(req, res) {
    if (req.authInfo.checkScope('$XSAPPNAME.User')) {
        try {
            let res1 = await core.executeHttpRequest({
                destinationName: req.query.destination,
                jwt: retrieveJwt(req)
            }, {
                method: 'GET',
                url: req.query.path || '/'
            });
            res.status(200).json(res1.data);
        } catch (err) {
            console.log(err.stack);
            res.status(500).send(err.message);
        }
    } else {
        res.status(403).send('Forbidden');
    }
});

const port = process.env.PORT || 5001;
app.listen(port, function() {
    console.info('Listening on http://localhost:' + port);
});