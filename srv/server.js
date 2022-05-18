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

////-------------------------- Start of changes ------------------------------////////////////
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
const sUaaCredentials = dest_service.clientid + ':' + dest_service.clientsecret;
const sS4HanaDestName = 'S4HanaBTPQA';
const sCpiDestName = 'OTPCPI';

app.get('/srv/info', function(req, res) {
    //$XSAPPNAME.User 
    //console.log("TokenInfo", req.tokenInfo.getPayload());
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
const fetchTokenHandler = (subdomain) => {
    var response = {};
    return axios({
        url: dest_service.url.split('://')[0] + '://' + subdomain + dest_service.url.slice(dest_service.url.indexOf('.')) + '/oauth/token?grant_type=client_credentials',
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(sUaaCredentials).toString('base64'),
            'Content-type': 'application/x-www-form-urlencoded'
        },
        form: {
            'client_id': dest_service.clientid,
            'grant_type': 'client_credentials'
        }
    }).then(function(res) {
        //console.log("responseToken====>>>>",response.data);
        response.data = res.data.access_token;
        response.statusCode = 202;
        return response;
        //(response) => response.json();
    }).catch(function(error) {
        console.log("Failed to get destination service Info.====>>>>", error);
        response.data = error;
        response.statusCode = error.response.status;
        return response;
    });
}
/////------------------- Get Token -------------- /////////////
app.get('/srv/getToken', (req, res) => {

    fetchTokenHandler(req.authInfo.getSubdomain()).then(
        (response) => {
            //console.log("token===>>",response.data);
            return res.type("application/json").status(response.statusCode).send({
                data: response.data
            });
        }
    );
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
        //console.log("decoded====>>>>", decoded);
        const exp = decoded.exp;
        //console.log("exp====>>>>", exp);
        const expired = (Date.now() >= exp * 1000);
        //console.log("expired===>>>", expired);
        return expired;
    } else {
        res.sendStatus(403);
    }
}
//////--------------------Selection service calls-------------------////////////////////////////
/////-------------------- Get Ledger From S/4 System ---------------////////////////////////////
app.post('/srv/getLedger', (req, res) => {
    var token = req.body.token;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        //console.log("Checking with expired token=====>>", expired);
        fetchTokenHandler(req.authInfo.getSubdomain()).then(
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
                return res.type("application/json").status(ledgerRes.statusCode).send({
                    results: ledgerRes.result
                });
            }
        );
    }
});
/////////---------- Get Ledger Function call ----------////////////////
const getLedger = (token) => {
    var ledgerRes = {};
    return axios({
        method: 'GET',
        url: dest_service.uri + '/destination-configuration/v1/destinations/' + sS4HanaDestName,
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(function(destData) {
        const oDestination = destData;
        const token = oDestination.data.authTokens[0];
        return axios({
            method: 'GET',
            url: oDestination.data.destinationConfiguration.URL + "/sap/opu/odata/sap/C_TRIALBALANCE_CDS/Ledger",
            headers: {
                "Accept": "application/json",
                "content-type": "application/json",
                'Authorization': `${token.type} ${token.value}`
            }
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
    }).catch(function(error) {
        console.log("Failed to authenticate token ====>>>>", error);
        return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
    });
}

/////-------------------- Get CompanyCode From S/4 System ---------------////////////////////////////
app.post('/srv/getCompanyCode', (req, res) => {
    var token = req.body.token;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
       // console.log("Checking with expired token=====>>", expired);
        fetchTokenHandler(req.authInfo.getSubdomain()).then(
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
                return res.type("application/json").status(companyCodeRes.statusCode).send({
                    results: companyCodeRes.result
                });
            }
        );
    }
});
/////--------------- Get Company code Funciton call --------------//////////////
const getCompanyCode = (token) => {
    var companyCodeRes = {};
    return axios({
        method: 'GET',
        url: dest_service.uri + '/destination-configuration/v1/destinations/' + sS4HanaDestName,
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(function(destData) {
        const oDestination = destData;
        const token = oDestination.data.authTokens[0];
        return axios({
            method: 'GET',
            url: oDestination.data.destinationConfiguration.URL + "/sap/opu/odata/sap/C_TRIALBALANCE_CDS/CompanyCode",
            headers: {
                "Accept": "application/json",
                "content-type": "application/json",
                'Authorization': `${token.type} ${token.value}`
            }
        }).then(function(result) {
            companyCodeRes.statusCode = 202;
            companyCodeRes.result = result.data.d;
            //console.log("companyCodeRes====>>>",companyCodeRes);
            return companyCodeRes;
        }).catch(function(error) {
            console.log("companyCode service Call failed===>>>> error", error);
            companyCodeRes.statusCode = error.response.status;
            companyCodeRes.result = error.response.data;
            return companyCodeRes;
        });
    }).catch(function(error) {
        console.log("Failed to authenticate token ====>>>>", error);
        return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
    });
}
/////-------------------- Get Trial Balance Data From S/4 System ---------------////////////////////////////
app.post('/srv/getTrialBalanceData', (req, res) => {
    const token = req.body.token;
    var spath = req.body.sPath;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        //console.log("Checking with expired token=====>>", expired);
        fetchTokenHandler(req.authInfo.getSubdomain()).then(
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
                return res.type("application/json").status(trialBalanceRes.statusCode).send({
                    results: trialBalanceRes.result
                });
            }
        );
    }
});
/////----------- get trial balance data function call --------////////////////////
const getTrialBalanceData = (token, spath) => {
    var trialBalanceRes = {};
    return axios({
        method: 'GET',
        url: dest_service.uri + '/destination-configuration/v1/destinations/' + sS4HanaDestName,
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(function(destData) {
        const oDestination = destData;
        const token = oDestination.data.authTokens[0];
        return axios({
            method: 'GET',
            url: oDestination.data.destinationConfiguration.URL + spath,
            headers: {
                "Accept": "application/json",
                "content-type": "application/json",
                "Application-Interface-key" : "saptest0", // 2gca5352
                'Authorization': `${token.type} ${token.value}`
            }
        }).then(function(result) {
            trialBalanceRes.statusCode = 202;
            trialBalanceRes.result = result.data.d;
            //console.log("trialBalanceRes====>>>",trialBalanceRes);
            return trialBalanceRes;
        }).catch(function(error) {
            console.log("trialBalance service Call failed===>>>> error", error);
            trialBalanceRes.statusCode = error.response.status;
            trialBalanceRes.result = error.response.data;
            return trialBalanceRes;
        });
    }).catch(function(error) {
        console.log("Failed to authenticate token ====>>>>", error);
        return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
    });
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////-------------------- Get CompnayCode Data From S/4 System ---------------////////////////////////////
app.post('/srv/getCompanyCodeData', (req, res) => {
    const token = req.body.token;
    var spath = req.body.sPath;
    const bearerHeader = req.headers['authorization'];
    const expired = tokenValidityCheck(bearerHeader);
    if (expired === true) {
        fetchTokenHandler(req.authInfo.getSubdomain()).then(
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
                return res.type("application/json").status(companyCodeDataRes.statusCode).send({
                    results: companyCodeDataRes.result
                });
            }
        );
    }
});
/////----------- get trial balance data function call --------////////////////////
const getCompanyCodeData = (token, spath) => {
    var companyCodeDataRes = {};
    return axios({
        method: 'GET',
        url: dest_service.uri + '/destination-configuration/v1/destinations/' + sS4HanaDestName,
        headers: {
            'Authorization': 'Bearer ' + token
        }
    }).then(function(destData) {
        const oDestination = destData;
        const token = oDestination.data.authTokens[0];
        return axios({
            method: 'GET',
            url: oDestination.data.destinationConfiguration.URL + spath,
            headers: {
                "Accept": "application/json",
                "content-type": "application/json",
                "Application-Interface-key" : "saptest0", // 2gca5352
                'Authorization': `${token.type} ${token.value}`
            }
        }).then(function(result) {
            companyCodeDataRes.statusCode = 202;
            companyCodeDataRes.result = result.data.d;
            //console.log("companyCodeDataRes====>>>",companyCodeDataRes);
            return companyCodeDataRes;
        }).catch(function(error) {
            console.log("companyCodeDataRes service Call failed===>>>> error", error);
            companyCodeDataRes.statusCode = error.response.status;
            companyCodeDataRes.result = error.response.data;
            return companyCodeDataRes;
        });
    }).catch(function(error) {
        console.log("Failed to authenticate token ====>>>>", error);
        return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
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
       // console.log("Checking with expired token=====>>", expired);
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
    //console.log("dest_service====>>>",dest_service);
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
            //console.log("Headers===>>>",response.headers);
            return axios({
                method: 'POST',
                url: oDestination.data.destinationConfiguration.URL + '/http/CPI/PushTrialBalance/V1.0',
                // withCredentials: true,
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
        console.log("Failed to authenticate token ====>>>>", error);
        return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
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
       // console.log("Checking with expired token=====>>", expired);
        fetchTokenHandler(subdomain).then(
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
                // withCredentials: true,
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
        return res.type("application/json").status(error.response.status).send(JSON.stringify(error.response.statusText));
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