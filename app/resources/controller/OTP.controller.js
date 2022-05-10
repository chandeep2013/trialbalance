sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageBox",
    "sap/m/Token",
    "sap/ui/core/BusyIndicator",
    "com/tr/trialbalance/model/formatter",
    "sap/m/Dialog",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel"
],
/**
 * @param {typeof sap.ui.core.mvc.Controller} Controller
 */
function(Controller, MessageBox, Token, BusyIndicator, formatter, Dialog, MessageToast, JSONModel) {
    var ledger, replaceCompanyCodeText;
    "use strict";
    return Controller.extend("com.tr.trialbalance.controller.OTP", {
        formatter: formatter,
        onInit: function() {
            var oOwnerComponent = this.getOwnerComponent()
            oRouter = oOwnerComponent.getRouter();
            oRouter.attachRouteMatched(this.onRouteMatched, this);
        },
        onRouteMatched: function() {
            var that = this;
            /////------------ Get User Info(Scopes) -------///////////
            var userModel = new JSONModel();
            $.ajax({
                method: "GET",
                url: "/srv/info",
                async: true,
                headers: {
                    ContentType: 'application/json',
                    Accept: 'application/json'
                },
                success: function(result) {
                    userModel.setData(result);
                    that.sAdminAvailable = "";
                    that.sUserAvailable = "";
                    if (result.origin === "sap.default") {
                        for (let i = 0; i < result.scope.length; i++) {
                            if (result.scope[i].includes("Administrator") === true && result.scope[i].includes("saastrialbalanceapp")) {
                                that.sAdminAvailable = true;
                            } else if (result.scope[i].includes("User") === true && result.scope[i].includes("saastrialbalanceapp")) {
                                that.sUserAvailable = true;
                            }
                        }
                    } else {
                        var roleCollections = result.tokenInfo["xs.system.attributes"]["xs.rolecollections"];
                        for (let i = 0; i < roleCollections.length; i++) {
                            if (roleCollections[i].includes("Administrator") === true && roleCollections[i].includes("saastrialbalanceapp")) {
                                that.sAdminAvailable = true;
                            } else if (roleCollections[i].includes("User") === true && roleCollections[i].includes("saastrialbalanceapp")) {
                                that.sUserAvailable = true;
                            }
                        }
                    }
                    if (that.sAdminAvailable !== true && that.sUserAvailable !== true) {
                        var sAuthorizationError = that.getView().getModel("i18n").getProperty("authorizationError");
                        if (!this.oErrorMessageDialog) {
                            this.oErrorMessageDialog = new Dialog({
                                type: "Message",
                                title: that.getView().getModel("i18n").getProperty("error"),
                                state: "Error",
                                content: new sap.m.Text({
                                    text: sAuthorizationError
                                }),
                                beginButton: new sap.m.Button({
                                    type: "Emphasized",
                                    text: that.getView().getModel("i18n").getProperty("ok"),
                                    press: function() {
                                        this.oErrorMessageDialog.close();
                                        window.location.replace('/my/logout');
                                    }.bind(this)
                                })
                            });
                        }
                        this.oErrorMessageDialog.open();
                        that.getView().byId("idTrialbalancePage").setVisible(false);
                    } else if (that.sAdminAvailable === true) {
                        that.getView().byId("idMessageStrip").setVisible(false);
                        that.getView().byId("idSend").setEnabled(true);
                        that.getView().byId("idMasterDataCheckBox").setEnabled(true);
                        that.getView().byId("idTrialBalanceDataCheckBox").setEnabled(true);
                        that._getToken();
                    } else {
                        that.getView().byId("idMessageStrip").setVisible(true);
                        that.getView().byId("idSend").setEnabled(false);
                        that.getView().byId("idMasterDataCheckBox").setEnabled(false);
                        that.getView().byId("idTrialBalanceDataCheckBox").setEnabled(false);
                        that._getToken();
                    }
                    that.getView().setModel(userModel, "userModel");
                },
                error: function(errorThrown) {
                    MessageBox.show(that.getView().getModel("i18n").getProperty("internalServerError"), {
                        title: that.getView().getModel("i18n").getProperty("error"),
                        icon: MessageBox.Icon.ERROR,
                        actions: sap.m.MessageBox.Action.OK
                    });
                }
            });
        },
        _getToken: function() {
            var that = this;
            ///------------- Get Token --------------/////////
            $.ajax({
                method: "GET",
                contentType: "application/json",
                url: "/srv/getToken",
                async: true,
                success: function(result) {
                    that.jwttoken = result.data;
                    that.SelectionServiceCalls(result.data);
                },
                error: function(errorThrown) {
                    MessageBox.show(that.getView().getModel("i18n").getProperty("jwtTokenError"), {
                        title: that.getView().getModel("i18n").getProperty("error"),
                        icon: MessageBox.Icon.ERROR,
                        actions: sap.m.MessageBox.Action.OK
                    });
                }
            });
        },
        SelectionServiceCalls: function(jwttoken) {
            var that = this;
            //////---------------------- Selection service calls ----------------------/////////
            var FilterParamModel = new JSONModel();
            var getLedger = jQuery.Deferred();
            var getCompanyCode = jQuery.Deferred();
            BusyIndicator.show(-1);
            let getLedgerPromise = new Promise(function(Resolve, Reject) {
                this._getCsrfToken(Resolve, Reject);
            }.bind(this));
            getLedgerPromise.then(
                function(token) {
                    //// -------- Ledger Service call ---------------//////
                    $.ajax({
                        method: "POST",
                        contentType: "application/json",
                        data: JSON.stringify({
                            "token": jwttoken
                        }),
                        headers: {
                            'X-CSRF-Token': token
                        },
                        url: "/srv/getLedger",
                        async: true,
                        success: function(result) {
                            var parseLedgerData = result.results;
                            getLedger.resolve(parseLedgerData.results);
                        },
                        error: function(errorThrown) {
                            getLedger.reject(errorThrown);
                            BusyIndicator.hide();
                        }
                    });
                },
                function(error) {
                    BusyIndicator.hide();
                    MessageBox.show(that.getView().getModel("i18n").getProperty("sessionExpiredError"), {
                        icon: MessageBox.Icon.WARNING,
                        title: that.getView().getModel("i18n").getProperty("sessionExpired"),
                        actions: ["Refresh", MessageBox.Action.CLOSE],
                        emphasizedAction: "Refresh",
                        onClose: function(oAction) {
                            if (oAction === "Refresh") {
                                window.location.reload(true);
                            }
                        }
                    });
                }
            );

            let getCompanyCodePromise = new Promise(function(Resolve, Reject) {
                this._getCsrfToken(Resolve, Reject);
            }.bind(this));
            getCompanyCodePromise.then(
                function(token) {
                    //// -------- CompanyCode Service call ---------------//////
                    $.ajax({
                        method: "POST",
                        contentType: "application/json",
                        data: JSON.stringify({
                            "token": jwttoken
                        }),
                        headers: {
                            'X-CSRF-Token': token
                        },
                        url: "/srv/getCompanyCode",
                        async: true,
                        success: function(result) {
                            var parseCompanyCodeData = result.results;
                            getCompanyCode.resolve(parseCompanyCodeData.results);
                        },
                        error: function(errorThrown) {
                            getCompanyCode.reject(errorThrown);
                            BusyIndicator.hide();
                        }
                    });
                },
                function(error) {
                    BusyIndicator.hide();
                    MessageBox.show(that.getView().getModel("i18n").getProperty("sessionExpiredError"), {
                        icon: MessageBox.Icon.WARNING,
                        title: that.getView().getModel("i18n").getProperty("sessionExpired"),
                        actions: ["Refresh", MessageBox.Action.CLOSE],
                        emphasizedAction: "Refresh",
                        onClose: function(oAction) {
                            if (oAction === "Refresh") {
                                window.location.reload(true);
                            }
                        }
                    });
                }
            );
            $.when(getLedger, getCompanyCode).done(
                function(LedgerResponse, CompanyCodeResponse) {
                    BusyIndicator.hide();
                    var oData = {
                        Ledger: LedgerResponse,
                        CompanyCode: CompanyCodeResponse
                    };
                    FilterParamModel.setData(oData);
                    this.getView().setModel(FilterParamModel, "ParamData");
                }.bind(this)).fail(function(LedgerResponse, CompanyCodeResponse) {
                if (LedgerResponse.status === 401) {
                    MessageBox.show(LedgerResponse.responseText, {
                        title: that.getView().getModel("i18n").getProperty("error"),
                        icon: MessageBox.Icon.ERROR,
                        actions: sap.m.MessageBox.Action.OK
                    });
                    return;
                }
                if (LedgerResponse.status === 404) {
                    MessageBox.show(JSON.parse(LedgerResponse.responseJSON.error).ErrorMessage, {
                        title: that.getView().getModel("i18n").getProperty("error"),
                        icon: MessageBox.Icon.ERROR,
                        actions: sap.m.MessageBox.Action.OK
                    });
                    return;
                } else if (LedgerResponse.status === 500) {
                    MessageBox.show(that.getView().getModel("i18n").getProperty("internalServerError"), {
                        title: that.getView().getModel("i18n").getProperty("error"),
                        icon: MessageBox.Icon.ERROR,
                        actions: sap.m.MessageBox.Action.OK
                    });
                    return;
                }
            }.bind(this));
        },
        onAfterRendering: function() {
            /* Set mandatory fields
               set fromdate as month start date 
               set todate as month end date*/
            this.getView().byId("idLedger").setMandatory(true);
            this.getView().byId("idCompanyCode").setMandatory(true);
            this.getView().byId("idPostedDateFrom").setMandatory(true);
            this.getView().byId("idPostedDateTo").setMandatory(true);
            var date = new Date();
            var firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDate();
            var lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
            if (firstDay < 10) {
                firstDay = "0" + firstDay;
            }
            this.getView().byId("fromDate").setDateValue(new Date(date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + firstDay));
            this.getView().byId("toDate").setDateValue(new Date(date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + lastDay));
        },
        _getCsrfToken: function(Resolve, Reject) {
            //////------- get x csrf token for post call ------//////
            $.ajax({
                method: "GET",
                url: "/srv/info",
                async: true,
                headers: {
                    ContentType: 'application/json',
                    Accept: 'application/json',
                    cache: false,
                    'X-CSRF-Token': 'Fetch'
                },
                success: function(data, textStatus, request) {
                    var token = request.getResponseHeader('X-Csrf-Token');
                    Resolve(token);
                },
                error: function(errorThrown) {
                    Reject(errorThrown); // when error
                    BusyIndicator.hide();
                }
            });
        },
        onLoadData: function(evt) {
            /////// ------------------- Pagination---------------------- /////
            if (evt.getSource().getId() === "__bar1") {
                loadmore = 0;
                total = 0;
                var trialbalancedatamodel = new JSONModel();
                var otrialbalancedata = {
                    "results": []
                };
                trialbalancedatamodel.setData(otrialbalancedata);
                this.getView().setModel(trialbalancedatamodel, "oModelData");
            }
            loadmore += 1;
            if (loadmore === 1) {
                var top = 50;
                var skip = 0;
            } else {
                top = 50;
                skip = top * (loadmore - 1);
            }
            this.onSearch(top, skip);
        },
        onSearch: function(top, skip) {
            ////------------------- get trialbalance data from s/4 system---------------////
            var that = this;
            BusyIndicator.show(-1);
            var fromDate = that.getView().byId("fromDate").getValue(),
                ToDate = that.getView().byId("toDate").getValue(),
                companyCode = that.getView().byId("idSelectedComapnyCode").getTokens(),
                aCodeEntries = [];
            for (let i = 0; i < companyCode.length; i++) {
                aCodeEntries.push("CompanyCode eq '" + parseInt(companyCode[i].getText()) + "'");
            }
            replaceCompanyCodeText = "( " + aCodeEntries.join(" or ") + " )";
            ledger = that.getView().byId("idSelectedLedger").getValue();
            if (that.getView().byId("fromDate").getDateValue() > that.getView().byId("toDate").getDateValue()) {
                MessageBox.show(that.getView().getModel("i18n").getProperty("datePeriodError"), {
                    title: that.getView().getModel("i18n").getProperty("error"),
                    icon: MessageBox.Icon.ERROR,
                    actions: sap.m.MessageBox.Action.OK
                });
                BusyIndicator.hide();
                return;
            }
            if (fromDate === "" || ToDate === "" || aCodeEntries.length === 0 || ledger === "") {
                MessageBox.show(that.getView().getModel("i18n").getProperty("madatoryFieldsError"), {
                    title: that.getView().getModel("i18n").getProperty("error"),
                    icon: MessageBox.Icon.ERROR,
                    actions: sap.m.MessageBox.Action.OK
                });
                BusyIndicator.hide();
                return;
            }
            //////-------------------------------------------------------------------//////
            var spath = "/sap/opu/odata/sap/C_TRIALBALANCE_CDS/C_TRIALBALANCE(P_FromPostingDate=datetime'" + fromDate + "T00:00:00',P_ToPostingDate=datetime'" + ToDate + "T00:00:00')/Results?$skip=" + skip + "&$top=" + top + "&$filter=Ledger eq '" + ledger + "' and {1} &$select=CompanyCode,GLAccount,GLAccountHierarchyName,ChartOfAccounts,StartingBalanceAmtInCoCodeCrcy,DebitAmountInCoCodeCrcy,CreditAmountInCoCodeCrcy,EndingBalanceAmtInCoCodeCrcy,CompanyCodeCurrency";
            spath = spath.replace("{1}", replaceCompanyCodeText);
            var oRequestBody = {
                "sPath": spath,
                "token": that.jwttoken
            };
            let getTrialBlancePromise = new Promise(function(Resolve, Reject) {
                this._getCsrfToken(Resolve, Reject);
            }.bind(this));
            getTrialBlancePromise.then(
                function(token) {
                    that.getTrialbalanceData(token, oRequestBody);
                },
                function(error) {
                    BusyIndicator.hide();
                    MessageBox.show(that.getView().getModel("i18n").getProperty("sessionExpiredError"), {
                        icon: MessageBox.Icon.WARNING,
                        title: that.getView().getModel("i18n").getProperty("sessionExpired"),
                        actions: ["Refresh", MessageBox.Action.CLOSE],
                        emphasizedAction: "Refresh",
                        onClose: function(oAction) {
                            if (oAction === "Refresh") {
                                window.location.reload(true);
                            }
                        }
                    });
                }
            );
        },
        getTrialbalanceData: function(token, oRequestBody) {
            ///////----------------- Get Trial Balance Data from S/4 Hana system -----------------////////
            var that = this;
            var oModel = new JSONModel();
            $.ajax({
                method: "POST",
                contentType: "application/json",
                url: "/srv/getTrialBalanceData",
                data: JSON.stringify(oRequestBody),
                headers: {
                    'X-CSRF-Token': token
                },
                async: true,
                success: function(result) {
                    BusyIndicator.hide();
                    var Data = result.results;
                    oModel.setData(Data);
                    total += Data.results.length;
                    if (Data.results.length < 50) {
                        that.getView().byId("idLoadMoreButton").setVisible(false);
                    } else {
                        that.getView().byId("idLoadMoreButton").setVisible(true);
                    }
                    //that.getView().byId("idTrialbalanceTable").setVisibleRowCount(total);
                    that.getView().byId("idTrailBalanceDataCount").setText("Trial Balance Data(" + total + ")");
                    var aJSONadd = oModel.getJSON(),
                        oJSONadd = JSON.parse(aJSONadd),
                        oModelService = that.getView().getModel("oModelData"), //this model is used for table binding
                        aJSON = oModelService.getJSON(),
                        oJSON = JSON.parse(aJSON);

                    oJSON.results = oJSON.results.concat(oJSONadd.results);
                    aJSON = JSON.stringify(oJSON);
                    oModelService.setJSON(aJSON);
                    that.getView().getModel("oModelData").refresh();
                },
                error: function(errorThrown) {
                    BusyIndicator.hide();
                    if (errorThrown.status === 404 || errorThrown.status === 403) {
                        var errormsg = errorThrown.responseText;
                    } else {
                        errormsg = errorThrown.responseJSON.message;
                    }
                    MessageBox.show(errormsg + ". " + that.getView().getModel("i18n").getProperty("supportError"), {
                        title: that.getView().getModel("i18n").getProperty("error"),
                        icon: MessageBox.Icon.ERROR,
                        actions: sap.m.MessageBox.Action.OK
                    });
                }
            });
        },
        onClear: function() {
            ////////--------- clear filters--------------/////
            this.getView().byId("fromDate").setValue("");
            this.getView().byId("toDate").setValue("");
            this.getView().byId("idSelectedLedger").setValue("");
            this.getView().byId("idSelectedComapnyCode").setTokens([]);
        },
        onPressSubmit: function() {
            //////////-------------- validations to post trial balance data ----------///////
            var that = this;
            var MasterDataCheckbox = this.getView().byId("idMasterDataCheckBox").getSelected(),
                TrialBalanceDataCheckbox = this.getView().byId("idTrialBalanceDataCheckBox").getSelected();
            if (that.getView().getModel("oModelData") === undefined) {
                MessageBox.show(that.getView().getModel("i18n").getProperty("noDataError"), {
                    title: that.getView().getModel("i18n").getProperty("error"),
                    icon: MessageBox.Icon.ERROR,
                    actions: sap.m.MessageBox.Action.OK
                });
                return;
            } else if (that.getView().getModel("oModelData").getData().results.length === 0) {
                MessageBox.show(that.getView().getModel("i18n").getProperty("noDataError"), {
                    title: that.getView().getModel("i18n").getProperty("error"),
                    icon: MessageBox.Icon.ERROR,
                    actions: sap.m.MessageBox.Action.OK
                });
                return;
            } else if (TrialBalanceDataCheckbox === true && MasterDataCheckbox === true) {
                that.tbAndCoa = true;
                that.coaExecuted = false;
                that.tbExecuted = false;
                that._PushToOTP();
                that._PushMasterDataToOTP();
                
            } else if (MasterDataCheckbox === false && TrialBalanceDataCheckbox === true) {
                that.tbAndCoa = false;
                that.coaExecuted = false;
                that.tbExecuted = false;
                that._PushToOTP();
                //that.stopBusy = true;
            } else if (MasterDataCheckbox === true && TrialBalanceDataCheckbox === false) {
                that.tbAndCoa = false;
                that.coaExecuted = false;
                that.tbExecuted = false;
                that._PushMasterDataToOTP();
                //that.stopBusy = true;
            } else {
                MessageBox.show(that.getView().getModel("i18n").getProperty("checkboxSelectionError"), {
                    title: that.getView().getModel("i18n").getProperty("error"),
                    icon: MessageBox.Icon.ERROR,
                    actions: sap.m.MessageBox.Action.OK
                });
                return;
            }
        },
        _headerInfo: function() {
            /////----------- set headers for node.js service ------////////
            var that = this;
            var filter = "Ledger eq '" + ledger + "' and {1}";
            filter = filter.replace("{1}", replaceCompanyCodeText);
            var reqbody = {
                "fromDate": that.getView().byId("fromDate").getValue(),
                "ToDate": that.getView().byId("toDate").getValue(),
                "filter": filter,
                "select": "CompanyCode,GLAccount,GLAccountHierarchyName,ChartOfAccounts,StartingBalanceAmtInCoCodeCrcy,DebitAmountInCoCodeCrcy,CreditAmountInCoCodeCrcy,EndingBalanceAmtInCoCodeCrcy,CompanyCodeCurrency,ProfitCenter,CostCenter",
                "format": "json",
                "token": that.jwttoken
            };
            return reqbody;
        },
        _PushToOTP: function() {
            ////-------------- Push Data to OTP-------------/////////////
            var that = this;
            var reqbody = this._headerInfo();
            let getPushtoOTPPromise = new Promise(function(Resolve, Reject) {
                this._getCsrfToken(Resolve, Reject);
            }.bind(this));
            getPushtoOTPPromise.then(
                function(token) {
                    BusyIndicator.show(-1);
                    $.ajax({
                        method: "POST",
                        contentType: "application/json",
                        url: "/srv/PostTrialbalanceData",
                        headers: {
                            'X-CSRF-Token': token
                        },
                        data: JSON.stringify(reqbody),
                        async: true,
                        success: function(result) {
                                if( that.tbAndCoa === true){
                                    that.tbExecuted = true;
                                    that._tbAndCoaSuccess();
                                }
                                else if(that.tbAndCoa !== true){
                                    BusyIndicator.hide();
                                }
                            MessageBox.success(that.getView().getModel("i18n").getProperty("trialbalanceSuccess"));
                        },
                        error: function(errorThrown) {
                            BusyIndicator.hide();
                            if (errorThrown.status === 404) {
                                var errormsg = that.getView().getModel("i18n").getProperty("notFoundError");
                            } else if (errorThrown.status === 504) {
                                errormsg = errorThrown.statusText;
                            } else if (errorThrown.status === 500) {
                                MessageBox.show(that.getView().getModel("i18n").getProperty("internalServerError"), {
                                    title: that.getView().getModel("i18n").getProperty("error"),
                                    icon: MessageBox.Icon.ERROR,
                                    actions: sap.m.MessageBox.Action.OK
                                });
                                return;
                            } else if (errorThrown.status === 400) {
                                errormsg = errorThrown.responseJSON.response.error.code;

                            } else {
                                errormsg = errorThrown.responseJSON.message === undefined ? JSON.parse(errorThrown.responseJSON.response).error : errorThrown.responseJSON.message;
                            }
                            MessageBox.show(errormsg + ". " + that.getView().getModel("i18n").getProperty("supportError"), {
                                title: that.getView().getModel("i18n").getProperty("error"),
                                icon: MessageBox.Icon.ERROR,
                                actions: sap.m.MessageBox.Action.OK
                            });
                            return;
                        }
                    });
                },
                function(error) {
                    BusyIndicator.hide();
                    MessageBox.show(that.getView().getModel("i18n").getProperty("sessionExpiredError"), {
                        icon: MessageBox.Icon.WARNING,
                        title: that.getView().getModel("i18n").getProperty("sessionExpired"),
                        actions: ["Refresh", MessageBox.Action.CLOSE],
                        emphasizedAction: "Refresh",
                        onClose: function(oAction) {
                            if (oAction === "Refresh") {
                                window.location.reload(true);
                            }
                        }
                    });
                }
            );
        },
        _tbAndCoaSuccess:function(){
            var that = this;
            if( that.tbAndCoa === true && that.tbExecuted === true && that.coaExecuted === true){
                BusyIndicator.hide();
            }
            else if(that.tbAndCoa !== true){
                BusyIndicator.hide();
            }
        },
        _PushMasterDataToOTP: function() {
            ///////---------------------- Master Data service call-------------/////////////////
            var that = this;
            var reqbody = this._headerInfo();
            BusyIndicator.show(-1);
            let pushMasterDataToOTPPromise = new Promise(function(Resolve, Reject) {
                this._getCsrfToken(Resolve, Reject);
            }.bind(this));
            pushMasterDataToOTPPromise.then(
                function(token) {
                    $.ajax({
                        method: "POST",
                        contentType: "application/json",
                        url: "/srv/PostCOAMasterData",
                        headers: {
                            'X-CSRF-Token': token
                        },
                        data: JSON.stringify(reqbody),
                        async: true,
                        success: function(result) {
                            if (result.response && result.response.Error !== undefined) {
                                BusyIndicator.hide();
                                MessageBox.show(result.response.Error, {
                                    title: that.getView().getModel("i18n").getProperty("error"),
                                    icon: MessageBox.Icon.ERROR,
                                    actions: sap.m.MessageBox.Action.OK
                                });
                                return;
                            }
                            if( that.tbAndCoa === true){
                                that.coaExecuted = true;
                                that._tbAndCoaSuccess();
                            }
                            else if(that.tbAndCoa !== true){
                                    BusyIndicator.hide();
                                    MessageBox.success(that.getView().getModel("i18n").getProperty("coaPostSuccess"));
                            }
                        },
                        error: function(errorThrown) {
                            //BusyIndicator.hide();
                            if( that.tbAndCoa === true){
                                that.coaExecuted = true;
                                that._tbAndCoaSuccess();
                            }
                            else if(that.tbAndCoa !== true){
                                    BusyIndicator.hide();
                            }
                            if (errorThrown.status === 400 && errorThrown.responseJSON.error && errorThrown.responseJSON.error.Message === "Accounts Created Successfully. Company Code already assigned to other entity.") {
                                errormsg = errorThrown.responseJSON.error.Message;
                                MessageBox.success(errormsg);
                                return;
                            } else if (errorThrown.status === 400 && errorThrown.responseJSON.response.Message === "Accounts Created Successfully. Company Code already assigned to other entity.") {
                                errormsg = errorThrown.responseJSON.response.Message;
                                MessageBox.success(errormsg);
                                return;
                            } else if (errorThrown.status === 504) {
                                errormsg = errorThrown.statusText;
                                MessageBox.show(errormsg, {
                                    title: that.getView().getModel("i18n").getProperty("error"),
                                    icon: MessageBox.Icon.ERROR,
                                    actions: sap.m.MessageBox.Action.OK
                                });
                                return;
                            } else if (errorThrown.status === 500) {
                                MessageBox.show(that.getView().getModel("i18n").getProperty("internalServerError"), {
                                    title: that.getView().getModel("i18n").getProperty("error"),
                                    icon: MessageBox.Icon.ERROR,
                                    actions: sap.m.MessageBox.Action.OK
                                });
                                return;
                            } else if (errorThrown.status === 404) {
                                var errormsg = "";
                                try {
                                    errormsg = errorThrown.responseJSON.response.Message;
                                    errormsg = errormsg === undefined ? that.getView().getModel("i18n").getProperty("masterdataSuccessMessage") : errormsg;
                                    MessageBox.success(errormsg);
                                } catch (err) {
                                    errormsg = that.getView().getModel("i18n").getProperty("notFoundError");
                                    MessageBox.show(errormsg, {
                                        title: that.getView().getModel("i18n").getProperty("error"),
                                        icon: MessageBox.Icon.ERROR,
                                        actions: sap.m.MessageBox.Action.OK
                                    });

                                }
                            } else {
                                errormsg = errorThrown.responseJSON.response.message;
                                title = errorThrown.statusTex;
                                MessageBox.show(errormsg + ". " + that.getView().getModel("i18n").getProperty("supportError"), {
                                    title: that.getView().getModel("i18n").getProperty("error"),
                                    icon: MessageBox.Icon.ERROR,
                                    actions: sap.m.MessageBox.Action.OK
                                });
                                return;
                            }
                        }
                    });
                },
                function(error) {
                    BusyIndicator.hide();
                    MessageBox.show(that.getView().getModel("i18n").getProperty("sessionExpiredError"), {
                        icon: MessageBox.Icon.WARNING,
                        title: that.getView().getModel("i18n").getProperty("sessionExpired"),
                        actions: ["Refresh", MessageBox.Action.CLOSE],
                        emphasizedAction: "Refresh",
                        onClose: function(oAction) {
                            if (oAction === "Refresh") {
                                window.location.reload(true);
                            }
                        }
                    });
                }
            );
        },
        onValueHelpRequestLedger: function() {
            // var that = this; ledger f4help
            if (!this.oDialogLedger) {
                this.oDialogLedger = sap.ui.xmlfragment("com.tr.trialbalance.fragments.LedgerF4Help", this);
                this.getView().addDependent(this.oDialogLedger);
            }
            this.oDialogLedger.open();
        },
        onLedgerCancel: function() {
            // close ledger
            this.oDialogLedger.close();
        },
        onLedgerF4HelpSelect: function(evt) {
            // select ledger field
            var selectedval = sap.ui.getCore().byId("idF4HelpLedgerTable").getSelectedContextPaths()[0];
            var selectedKey = this.getView().getModel("ParamData").getProperty(selectedval);
            if (selectedKey === null) {
                MessageToast.show("Select Ledger!");
                return;
            }
            this.getView().byId("idSelectedLedger").setValue(selectedKey.Ledger);
            this.oDialogLedger.close();
        },
        onValueHelpRequestCompanyCode: function() {
            // companycode f4help
            //var that = this;
            if (!this.oDialogCompanyCode) {
                this.oDialogCompanyCode = sap.ui.xmlfragment("com.tr.trialbalance.fragments.CompanyCodeF4Help", this);
                this.getView().addDependent(this.oDialogCompanyCode);
            }
            this.oDialogCompanyCode.open();
        },
        onCompanyCodeCancel: function() {
            // close companycode
            this.oDialogCompanyCode.close();
        },
        onCompanyCodeF4HelpSelect: function(evt) {
            // select comapanycode fields
            var aSelectedItems = sap.ui.getCore().byId("idF4HelpCompanyCodeTable").getSelectedItems(),
                oMultiInput = this.getView().byId("idSelectedComapnyCode");
            this.getView().byId("idSelectedComapnyCode").setTokens([]);
            if (aSelectedItems && aSelectedItems.length > 0) {
                aSelectedItems.forEach(function(oItem) {
                    if (oItem.getCells()[0].getText() !== "#") {
                        oMultiInput.addToken(new Token({
                            text: oItem.getCells()[0].getText()
                        }));
                    }
                });
            }
            this.oDialogCompanyCode.close();
        },
        OnSearchComapanyCode: function() {
            // companycode filter
            //var sQuery = oEvent.getParameter("query");
            var sQuery = sap.ui.getCore().byId("idSearchCompanyCode").getValue();
            var Title = new sap.ui.model.Filter("CompanyCode", sap.ui.model.FilterOperator.Contains, sQuery);
            var Desc = new sap.ui.model.Filter("CompanyCodeName", sap.ui.model.FilterOperator.Contains, sQuery);
            var filters = new sap.ui.model.Filter([Title, Desc]);
            var listassign = sap.ui.getCore().byId("idF4HelpCompanyCodeTable");
            listassign.getBinding("items").filter(filters, "Appliation");
        },
        onLogout: function() {
            ///// -------- logout Service call ---------------//////
            MessageBox.warning(this.getView().getModel("i18n").getProperty("logoutConfirm"), {
                icon: MessageBox.Icon.WARNING,
                title: "Confirmation",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                onClose: function(oAction) {
                    if (oAction === "OK") {
                        window.location.replace('/my/logout');
                    }
                }
            });
        }
    });
});