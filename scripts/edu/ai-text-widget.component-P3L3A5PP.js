import{a as xe}from"./chunk-ACGCOU45.js";import{b as ge,f as ue,g as he,i as it,k as Ce}from"./chunk-33IXSVE2.js";import"./chunk-Y73H2HTO.js";import"./chunk-7A2J6TXB.js";import{$ as fe,O as _e,S as et,a as pe}from"./chunk-QTFKFALX.js";import"./chunk-VZBF6OYS.js";import{n as de,q as ce}from"./chunk-FWH7SB6Z.js";import"./chunk-3XME4YAP.js";import"./chunk-WLPEPZJO.js";import"./chunk-DGKSBEBL.js";import"./chunk-3HCJPZKW.js";import"./chunk-7HFYUAAR.js";import"./chunk-RCMRSRR7.js";import{la as tt,ma as me}from"./chunk-ZRNJMGFX.js";import{$a as zt,Ab as Yt,Bc as le,La as Bt,Ma as Gt,Ra as jt,Wa as Ht,hb as qt,ib as $t,jb as Qt,kb as Xt,kc as ne,sc as oe,tc as ae,ua as Wt,wc as se,xc as re,za as Ft}from"./chunk-ZADMOOTO.js";import"./chunk-QH5ZVD6S.js";import{H as ee,I as ie,b as Jt,g as Zt,n as te}from"./chunk-XSURDK2E.js";import{d as Et,e as Nt}from"./chunk-7SRXXGKM.js";import{Ab as Lt,Ga as kt,Qb as Ut,R as J,Ub as Kt,X as Z,ja as Rt,m as wt,oa as Vt,u as Ot}from"./chunk-GXIUXYCT.js";import{A as st,Aa as mt,Ac as b,Bc as d,Ca as W,Cc as l,Cd as p,Dc as Q,Dd as g,Ea as m,Gd as Pt,H as rt,Hb as r,Jc as ft,Ka as C,La as x,M as lt,Mc as P,Nc as Ct,Oa as U,P as O,Pd as Y,Rc as y,Sa as A,Uc as s,Wa as M,Yc as xt,Z as L,Za as pt,Zb as F,Zc as bt,_b as ut,_c as yt,a as k,b as at,bc as ht,cb as gt,cc as E,cd as vt,ed as B,hd as u,i as f,id as Tt,jd as T,kd as X,md as Dt,nd as St,o as H,od as It,pa as dt,q as z,rc as _t,tc as h,vc as _,wd as At,xc as K,xd as Mt,yc as q,za as ct,zc as $}from"./chunk-SISH7RCI.js";function Pe(e,o){}var j=class{viewContainerRef;injector;id;role="dialog";panelClass="";hasBackdrop=!0;backdropClass="";disableClose=!1;closePredicate;width="";height="";minWidth;minHeight;maxWidth;maxHeight;position;data=null;direction;ariaDescribedBy=null;ariaLabelledBy=null;ariaLabel=null;ariaModal=!1;autoFocus="first-tabbable";restoreFocus=!0;delayFocusTrap=!0;scrollStrategy;closeOnNavigation=!0;enterAnimationDuration;exitAnimationDuration},nt="mdc-dialog--open",be="mdc-dialog--opening",ye="mdc-dialog--closing",we=150,Oe=75,Ee=(()=>{class e extends $t{_animationStateChanged=new A;_animationsEnabled=!J();_actionSectionCount=0;_hostElement=this._elementRef.nativeElement;_enterAnimationDuration=this._animationsEnabled?Te(this._config.enterAnimationDuration)??we:0;_exitAnimationDuration=this._animationsEnabled?Te(this._config.exitAnimationDuration)??Oe:0;_animationTimer=null;_contentAttached(){super._contentAttached(),this._startOpenAnimation()}_startOpenAnimation(){this._animationStateChanged.emit({state:"opening",totalTime:this._enterAnimationDuration}),this._animationsEnabled?(this._hostElement.style.setProperty(ve,`${this._enterAnimationDuration}ms`),this._requestAnimationFrame(()=>this._hostElement.classList.add(be,nt)),this._waitForAnimationToComplete(this._enterAnimationDuration,this._finishDialogOpen)):(this._hostElement.classList.add(nt),Promise.resolve().then(()=>this._finishDialogOpen()))}_startExitAnimation(){this._animationStateChanged.emit({state:"closing",totalTime:this._exitAnimationDuration}),this._hostElement.classList.remove(nt),this._animationsEnabled?(this._hostElement.style.setProperty(ve,`${this._exitAnimationDuration}ms`),this._requestAnimationFrame(()=>this._hostElement.classList.add(ye)),this._waitForAnimationToComplete(this._exitAnimationDuration,this._finishDialogClose)):Promise.resolve().then(()=>this._finishDialogClose())}_updateActionSectionCount(t){this._actionSectionCount+=t,this._changeDetectorRef.markForCheck()}_finishDialogOpen=()=>{this._clearAnimationClasses(),this._openAnimationDone(this._enterAnimationDuration)};_finishDialogClose=()=>{this._clearAnimationClasses(),this._animationStateChanged.emit({state:"closed",totalTime:this._exitAnimationDuration})};_clearAnimationClasses(){this._hostElement.classList.remove(be,ye)}_waitForAnimationToComplete(t,i){this._animationTimer!==null&&clearTimeout(this._animationTimer),this._animationTimer=setTimeout(i,t)}_requestAnimationFrame(t){this._ngZone.runOutsideAngular(()=>{typeof requestAnimationFrame=="function"?requestAnimationFrame(t):t()})}_captureInitialFocus(){this._config.delayFocusTrap||this._trapFocus()}_openAnimationDone(t){this._config.delayFocusTrap&&this._trapFocus(),this._animationStateChanged.next({state:"opened",totalTime:t})}ngOnDestroy(){super.ngOnDestroy(),this._animationTimer!==null&&clearTimeout(this._animationTimer)}attachComponentPortal(t){let i=super.attachComponentPortal(t);return i.location.nativeElement.classList.add("mat-mdc-dialog-component-host"),i}static \u0275fac=(()=>{let t;return function(n){return(t||(t=gt(e)))(n||e)}})();static \u0275cmp=F({type:e,selectors:[["mat-dialog-container"]],hostAttrs:["tabindex","-1",1,"mat-mdc-dialog-container","mdc-dialog"],hostVars:10,hostBindings:function(i,n){i&2&&(Ct("id",n._config.id),_t("aria-modal",n._config.ariaModal)("role",n._config.role)("aria-labelledby",n._config.ariaLabel?null:n._ariaLabelledByQueue[0])("aria-label",n._config.ariaLabel)("aria-describedby",n._config.ariaDescribedBy||null),B("_mat-animation-noopable",!n._animationsEnabled)("mat-mdc-dialog-container-with-actions",n._actionSectionCount>0))},features:[ht],decls:3,vars:0,consts:[[1,"mat-mdc-dialog-inner-container","mdc-dialog__container"],[1,"mat-mdc-dialog-surface","mdc-dialog__surface"],["cdkPortalOutlet",""]],template:function(i,n){i&1&&(d(0,"div",0)(1,"div",1),E(2,Pe,0,0,"ng-template",2),l()())},dependencies:[Bt],styles:[`.mat-mdc-dialog-container {
  width: 100%;
  height: 100%;
  display: block;
  box-sizing: border-box;
  max-height: inherit;
  min-height: inherit;
  min-width: inherit;
  max-width: inherit;
  outline: 0;
}

.cdk-overlay-pane.mat-mdc-dialog-panel {
  max-width: var(--mat-dialog-container-max-width, 560px);
  min-width: var(--mat-dialog-container-min-width, 280px);
}
@media (max-width: 599px) {
  .cdk-overlay-pane.mat-mdc-dialog-panel {
    max-width: var(--mat-dialog-container-small-max-width, calc(100vw - 32px));
  }
}

.mat-mdc-dialog-inner-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-around;
  box-sizing: border-box;
  height: 100%;
  opacity: 0;
  transition: opacity linear var(--mat-dialog-transition-duration, 0ms);
  max-height: inherit;
  min-height: inherit;
  min-width: inherit;
  max-width: inherit;
}
.mdc-dialog--closing .mat-mdc-dialog-inner-container {
  transition: opacity 75ms linear;
  transform: none;
}
.mdc-dialog--open .mat-mdc-dialog-inner-container {
  opacity: 1;
}
._mat-animation-noopable .mat-mdc-dialog-inner-container {
  transition: none;
}

.mat-mdc-dialog-surface {
  display: flex;
  flex-direction: column;
  flex-grow: 0;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  position: relative;
  overflow-y: auto;
  outline: 0;
  transform: scale(0.8);
  transition: transform var(--mat-dialog-transition-duration, 0ms) cubic-bezier(0, 0, 0.2, 1);
  max-height: inherit;
  min-height: inherit;
  min-width: inherit;
  max-width: inherit;
  box-shadow: var(--mat-dialog-container-elevation-shadow, none);
  border-radius: var(--mat-dialog-container-shape, var(--mat-sys-corner-extra-large, 4px));
  background-color: var(--mat-dialog-container-color, var(--mat-sys-surface, white));
}
[dir=rtl] .mat-mdc-dialog-surface {
  text-align: right;
}
.mdc-dialog--open .mat-mdc-dialog-surface, .mdc-dialog--closing .mat-mdc-dialog-surface {
  transform: none;
}
._mat-animation-noopable .mat-mdc-dialog-surface {
  transition: none;
}
.mat-mdc-dialog-surface::before {
  position: absolute;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  border: 2px solid transparent;
  border-radius: inherit;
  content: "";
  pointer-events: none;
}

.mat-mdc-dialog-title {
  display: block;
  position: relative;
  flex-shrink: 0;
  box-sizing: border-box;
  margin: 0 0 1px;
  padding: var(--mat-dialog-headline-padding, 6px 24px 13px);
}
.mat-mdc-dialog-title::before {
  display: inline-block;
  width: 0;
  height: 40px;
  content: "";
  vertical-align: 0;
}
[dir=rtl] .mat-mdc-dialog-title {
  text-align: right;
}
.mat-mdc-dialog-container .mat-mdc-dialog-title {
  color: var(--mat-dialog-subhead-color, var(--mat-sys-on-surface, rgba(0, 0, 0, 0.87)));
  font-family: var(--mat-dialog-subhead-font, var(--mat-sys-headline-small-font, inherit));
  line-height: var(--mat-dialog-subhead-line-height, var(--mat-sys-headline-small-line-height, 1.5rem));
  font-size: var(--mat-dialog-subhead-size, var(--mat-sys-headline-small-size, 1rem));
  font-weight: var(--mat-dialog-subhead-weight, var(--mat-sys-headline-small-weight, 400));
  letter-spacing: var(--mat-dialog-subhead-tracking, var(--mat-sys-headline-small-tracking, 0.03125em));
}

.mat-mdc-dialog-content {
  display: block;
  flex-grow: 1;
  box-sizing: border-box;
  margin: 0;
  overflow: auto;
  max-height: 65vh;
}
.mat-mdc-dialog-content > :first-child {
  margin-top: 0;
}
.mat-mdc-dialog-content > :last-child {
  margin-bottom: 0;
}
.mat-mdc-dialog-container .mat-mdc-dialog-content {
  color: var(--mat-dialog-supporting-text-color, var(--mat-sys-on-surface-variant, rgba(0, 0, 0, 0.6)));
  font-family: var(--mat-dialog-supporting-text-font, var(--mat-sys-body-medium-font, inherit));
  line-height: var(--mat-dialog-supporting-text-line-height, var(--mat-sys-body-medium-line-height, 1.5rem));
  font-size: var(--mat-dialog-supporting-text-size, var(--mat-sys-body-medium-size, 1rem));
  font-weight: var(--mat-dialog-supporting-text-weight, var(--mat-sys-body-medium-weight, 400));
  letter-spacing: var(--mat-dialog-supporting-text-tracking, var(--mat-sys-body-medium-tracking, 0.03125em));
}
.mat-mdc-dialog-container .mat-mdc-dialog-content {
  padding: var(--mat-dialog-content-padding, 20px 24px);
}
.mat-mdc-dialog-container-with-actions .mat-mdc-dialog-content {
  padding: var(--mat-dialog-with-actions-content-padding, 20px 24px 0);
}
.mat-mdc-dialog-container .mat-mdc-dialog-title + .mat-mdc-dialog-content {
  padding-top: 0;
}

.mat-mdc-dialog-actions {
  display: flex;
  position: relative;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  box-sizing: border-box;
  min-height: 52px;
  margin: 0;
  border-top: 1px solid transparent;
  padding: var(--mat-dialog-actions-padding, 16px 24px);
  justify-content: var(--mat-dialog-actions-alignment, flex-end);
}
@media (forced-colors: active) {
  .mat-mdc-dialog-actions {
    border-top-color: CanvasText;
  }
}
.mat-mdc-dialog-actions.mat-mdc-dialog-actions-align-start, .mat-mdc-dialog-actions[align=start] {
  justify-content: start;
}
.mat-mdc-dialog-actions.mat-mdc-dialog-actions-align-center, .mat-mdc-dialog-actions[align=center] {
  justify-content: center;
}
.mat-mdc-dialog-actions.mat-mdc-dialog-actions-align-end, .mat-mdc-dialog-actions[align=end] {
  justify-content: flex-end;
}
.mat-mdc-dialog-actions .mat-button-base + .mat-button-base,
.mat-mdc-dialog-actions .mat-mdc-button-base + .mat-mdc-button-base {
  margin-left: 8px;
}
[dir=rtl] .mat-mdc-dialog-actions .mat-button-base + .mat-button-base,
[dir=rtl] .mat-mdc-dialog-actions .mat-mdc-button-base + .mat-mdc-button-base {
  margin-left: 0;
  margin-right: 8px;
}

.mat-mdc-dialog-component-host {
  display: contents;
}
`],encapsulation:2})}return e})(),ve="--mat-dialog-transition-duration";function Te(e){return e==null?null:typeof e=="number"?e:e.endsWith("ms")?Z(e.substring(0,e.length-2)):e.endsWith("s")?Z(e.substring(0,e.length-1))*1e3:e==="0"?0:null}var G=(function(e){return e[e.OPEN=0]="OPEN",e[e.CLOSING=1]="CLOSING",e[e.CLOSED=2]="CLOSED",e})(G||{}),ot=class{_ref;_config;_containerInstance;componentInstance;componentRef=null;disableClose;id;_afterOpened=new z(1);_beforeClosed=new z(1);_result;_closeFallbackTimeout;_state=G.OPEN;_closeInteractionType;constructor(o,t,i){this._ref=o,this._config=t,this._containerInstance=i,this.disableClose=t.disableClose,this.id=o.id,o.addPanelClass("mat-mdc-dialog-panel"),i._animationStateChanged.pipe(O(n=>n.state==="opened"),L(1)).subscribe(()=>{this._afterOpened.next(),this._afterOpened.complete()}),i._animationStateChanged.pipe(O(n=>n.state==="closed"),L(1)).subscribe(()=>{clearTimeout(this._closeFallbackTimeout),this._finishDialogClose()}),o.overlayRef.detachments().subscribe(()=>{this._beforeClosed.next(this._result),this._beforeClosed.complete(),this._finishDialogClose()}),lt(this.backdropClick(),this.keydownEvents().pipe(O(n=>n.keyCode===27&&!this.disableClose&&!Rt(n)))).subscribe(n=>{this.disableClose||(n.preventDefault(),Ne(this,n.type==="keydown"?"keyboard":"mouse"))})}close(o){let t=this._config.closePredicate;t&&!t(o,this._config,this.componentInstance)||(this._result=o,this._containerInstance._animationStateChanged.pipe(O(i=>i.state==="closing"),L(1)).subscribe(i=>{this._beforeClosed.next(o),this._beforeClosed.complete(),this._ref.overlayRef.detachBackdrop(),this._closeFallbackTimeout=setTimeout(()=>this._finishDialogClose(),i.totalTime+100)}),this._state=G.CLOSING,this._containerInstance._startExitAnimation())}afterOpened(){return this._afterOpened}afterClosed(){return this._ref.closed}beforeClosed(){return this._beforeClosed}backdropClick(){return this._ref.backdropClick}keydownEvents(){return this._ref.keydownEvents}updatePosition(o){let t=this._ref.config.positionStrategy;return o&&(o.left||o.right)?o.left?t.left(o.left):t.right(o.right):t.centerHorizontally(),o&&(o.top||o.bottom)?o.top?t.top(o.top):t.bottom(o.bottom):t.centerVertically(),this._ref.updatePosition(),this}updateSize(o="",t=""){return this._ref.updateSize(o,t),this}addPanelClass(o){return this._ref.addPanelClass(o),this}removePanelClass(o){return this._ref.removePanelClass(o),this}getState(){return this._state}_finishDialogClose(){this._state=G.CLOSED,this._ref.close(this._result,{focusOrigin:this._closeInteractionType}),this.componentInstance=null}};function Ne(e,o,t){return e._closeInteractionType=o,e.close(t)}var Re=new W("MatMdcDialogData"),Ve=new W("mat-mdc-dialog-default-options"),ke=new W("mat-mdc-dialog-scroll-strategy",{providedIn:"root",factory:()=>{let e=m(U);return()=>jt(e)}}),Le=(()=>{class e{_defaultOptions=m(Ve,{optional:!0});_scrollStrategy=m(ke);_parentDialog=m(e,{optional:!0,skipSelf:!0});_idGenerator=m(Vt);_injector=m(U);_dialog=m(Qt);_animationsDisabled=J();_openDialogsAtThisLevel=[];_afterAllClosedAtThisLevel=new H;_afterOpenedAtThisLevel=new H;dialogConfigClass=j;_dialogRefConstructor;_dialogContainerType;_dialogDataToken;get openDialogs(){return this._parentDialog?this._parentDialog.openDialogs:this._openDialogsAtThisLevel}get afterOpened(){return this._parentDialog?this._parentDialog.afterOpened:this._afterOpenedAtThisLevel}_getAfterAllClosed(){let t=this._parentDialog;return t?t._getAfterAllClosed():this._afterAllClosedAtThisLevel}afterAllClosed=rt(()=>this.openDialogs.length?this._getAfterAllClosed():this._getAfterAllClosed().pipe(dt(void 0)));constructor(){this._dialogRefConstructor=ot,this._dialogContainerType=Ee,this._dialogDataToken=Re}open(t,i){let n;i=k(k({},this._defaultOptions||new j),i),i.id=i.id||this._idGenerator.getId("mat-mdc-dialog-"),i.scrollStrategy=i.scrollStrategy||this._scrollStrategy();let a=this._dialog.open(t,at(k({},i),{positionStrategy:Ht(this._injector).centerHorizontally().centerVertically(),disableClose:!0,closePredicate:void 0,closeOnDestroy:!1,closeOnOverlayDetachments:!1,disableAnimations:this._animationsDisabled||i.enterAnimationDuration?.toLocaleString()==="0"||i.exitAnimationDuration?.toString()==="0",container:{type:this._dialogContainerType,providers:()=>[{provide:this.dialogConfigClass,useValue:i},{provide:qt,useValue:i}]},templateContext:()=>({dialogRef:n}),providers:(c,v,I)=>(n=new this._dialogRefConstructor(c,i,I),n.updatePosition(i?.position),[{provide:this._dialogContainerType,useValue:I},{provide:this._dialogDataToken,useValue:v.data},{provide:this._dialogRefConstructor,useValue:n}])}));return n.componentRef=a.componentRef,n.componentInstance=a.componentInstance,this.openDialogs.push(n),this.afterOpened.next(n),n.afterClosed().subscribe(()=>{let c=this.openDialogs.indexOf(n);c>-1&&(this.openDialogs.splice(c,1),this.openDialogs.length||this._getAfterAllClosed().next())}),n}closeAll(){this._closeDialogs(this.openDialogs)}getDialogById(t){return this.openDialogs.find(i=>i.id===t)}ngOnDestroy(){this._closeDialogs(this._openDialogsAtThisLevel),this._afterAllClosedAtThisLevel.complete(),this._afterOpenedAtThisLevel.complete()}_closeDialogs(t){let i=t.length;for(;i--;)t[i].close()}static \u0275fac=function(i){return new(i||e)};static \u0275prov=ct({token:e,factory:e.\u0275fac,providedIn:"root"})}return e})();var De=(()=>{class e{static \u0275fac=function(i){return new(i||e)};static \u0275mod=ut({type:e});static \u0275inj=mt({providers:[Le],imports:[Xt,zt,Gt,kt]})}return e})();var We=["promptTextarea"],Fe=()=>({standalone:!0}),Be=e=>({type:e});function Ge(e,o){e&1&&ft(0)}function je(e,o){if(e&1&&E(0,Ge,1,0,"ng-container",4),e&2){s(2);let t=vt(3);b("ngTemplateOutlet",t)}}function He(e,o){if(e&1){let t=P();d(0,"code",13),y("click",function(){let n=C(t).$implicit,a=s(4);return x(a.appendDimensionKey(n))}),u(1),l(),u(2),p(3,"translate")}if(e&2){let t=o.$implicit,i=o.$index,n=s(4);r(),Tt(n.dimensionPrefix+t+n.dimensionSuffix),r(),X(" ",i<=n.availableSelectDimensionKeys.length-3?", ":""," ",i===n.availableSelectDimensionKeys.length-2?" "+g(3,3,n.i18nPrefix+"AND"):""," ")}}function ze(e,o){if(e&1&&(q(0,He,4,5,null,null,K),u(2," . ")),e&2){let t=s(3);$(t.availableSelectDimensionKeys)}}function Ue(e,o){if(e&1){let t=P();d(0,"es-mds-editor-single-widget",17),y("ngModelChange",function(n){let a=C(t).$implicit,c=s(5);return c.latestSelectedDimensionValues[a]=n,x(c.updateResultInput())}),l()}if(e&2){let t=o.$implicit,i=s(5);b("editorMode","form")("mds",i.mds)("widgetId",t)("customAttributes",Mt(5,Be,i.MdsWidgetType.Singleoption))("ngModel",i.latestSelectedDimensionValues[t])}}function Ke(e,o){if(e&1&&(d(0,"div",15),q(1,Ue,1,7,"es-mds-editor-single-widget",16,K),l()),e&2){let t=s(4);B("topic-page-grid-cols-1",t.selectDimensionKeysUsed.length===1)("topic-page-grid-cols-2",t.selectDimensionKeysUsed.length%2===0)("topic-page-grid-cols-3",t.selectDimensionKeysUsed.length>2&&t.selectDimensionKeysUsed.length%2!==0),r(),$(t.selectDimensionKeysUsed)}}function qe(e,o){if(e&1&&(d(0,"div",10)(1,"h3",5),u(2),p(3,"translate"),l(),d(4,"p"),u(5),p(6,"translate"),l(),h(7,Ke,3,6,"div",14),l()),e&2){let t=s(3);r(2),T(" ",g(3,3,t.i18nPrefix+"ANSWERS_LABEL")," "),r(3),T(" ",g(6,5,t.i18nPrefix+"ANSWERS_DESCRIPTION")," "),r(2),_(t.selectDimensionKeysUsed.length>0&&!t.processPromptInProgress?7:-1)}}function $e(e,o){if(e&1){let t=P();d(0,"es-editable-text",18),p(1,"translate"),y("textChange",function(n){C(t);let a=s(3);return a.resultInput=n,x(a.saveModification())}),l()}if(e&2){let t=s(3);b("applyTextareaPadding",!1)("disabled",t.disabled()||t.processPromptInProgress)("editable",!0)("label",g(1,8,t.i18nPrefix+"CURRENT_SELECTION_ANSWER_LABEL"))("inputLimit",1e3)("nonEditText",t.resultInput)("showMoreLimit",650)("text",t.resultInput)}}function Qe(e,o){if(e&1){let t=P();d(0,"div",3)(1,"h3",5),u(2),p(3,"translate"),l(),d(4,"p",6),u(5),p(6,"translate"),p(7,"translate"),h(8,ze,3,0),l(),d(9,"mat-form-field",7)(10,"mat-label"),u(11),p(12,"translate"),l(),d(13,"textarea",8,1),p(15,"translate"),It("ngModelChange",function(n){C(t);let a=s(2);return St(a.promptInput,n)||(a.promptInput=n),x(n)}),y("change",function(){C(t);let n=s(2);return x(n.checkForPromptChanges())}),l()(),d(16,"p"),u(17),p(18,"translate"),l(),d(19,"button",9),y("click",function(){C(t);let n=s(2);return x(n.processPromptUpdate())}),u(20),p(21,"translate"),l(),h(22,qe,8,7,"div",10),h(23,$e,2,10,"es-editable-text",11),d(24,"div")(25,"button",9),y("click",function(){C(t);let n=s(2);return x(n.generateTextForSelection())}),u(26),p(27,"translate"),l()(),d(28,"es-widget-configuration-buttons",12),y("optionOneClicked",function(){C(t);let n=s(2);return x(n.embedWidget())}),l()()}if(e&2){let t=s(2);r(2),T(" ",g(3,18,t.i18nPrefix+"HEADING")," "),r(3),X(" ",g(6,20,t.i18nPrefix+"PROMPT_DESCRIPTION")," ",g(7,22,t.i18nPrefix+"PLACEHOLDER_DESCRIPTION")," "),r(3),_(t.availableSelectDimensionKeys.length>0?8:-1),r(3),T(" ",g(12,24,t.i18nPrefix+"PROMPT_LABEL")," "),r(2),b("placeholder",g(15,26,t.i18nPrefix+"PROMPT_PLACEHOLDER")),Dt("ngModel",t.promptInput),b("ngModelOptions",At(34,Fe)),r(4),T(" ",g(18,28,t.i18nPrefix+"SEND_HINT")," "),r(2),b("disabled",t.disabled()||t.processPromptInProgress),r(),T(" ",g(21,30,t.i18nPrefix+"SEND")," "),r(2),_(t.latestStoredPrompt?22:-1),r(),_(t.latestStoredPrompt?23:-1),r(2),b("disabled",t.disabled()),r(),T(" ",g(27,32,t.i18nPrefix+"GENERATE_TEXT")," "),r(2),b("optionOne",t.embedConfigurationOption)("pageVariantNode",t.pageVariantNode)("swimlaneIndex",t.swimlaneIndex)}}function Xe(e,o){if(e&1){let t=P();d(0,"es-editable-text",20),p(1,"translate"),y("searchResultsUpdated",function(n){C(t);let a=s(3);return x(a.updateSearchResults(n))}),l()}if(e&2){let t=s(3);b("aiGenerated",t.aiGeneratedText())("editable",!1)("label",g(1,6,t.i18nPrefix+"CURRENT_SELECTION_ANSWER_LABEL"))("nonEditText",t.resultString)("searchInput",t.searchInput())("text",t.resultString)}}function Ye(e,o){if(e&1&&(d(0,"div",21),u(1),p(2,"translate"),l()),e&2){let t=s(4);r(),T(" ",g(2,1,t.i18nPrefix+"NO_ANSWER_DEFINED")," ")}}function Je(e,o){if(e&1&&h(0,Ye,3,3,"div",21),e&2){let t=s(3);_(t.initialized()&&!t.reloadingIndicator()?0:-1)}}function Ze(e,o){if(e&1&&h(0,Xe,2,8,"es-editable-text",19)(1,Je,1,1),e&2){let t=s(2);_(t.resultString?0:1)}}function ti(e,o){if(e&1&&(d(0,"div",2),h(1,je,1,1,"ng-container"),h(2,Qe,29,35,"div",3)(3,Ze,2,1),l()),e&2){let t=s();r(),_(t.reloadingIndicator()?1:-1),r(),_(t.editMode()?2:3)}}function ei(e,o){e&1&&(d(0,"div",22),Q(1,"es-spinner"),l())}function ii(e,o){if(e&1&&h(0,ei,2,0,"div",22),e&2){let t=s();_(t.reloadingIndicator()?0:-1)}}function ni(e,o){e&1&&(d(0,"div",22),Q(1,"es-spinner"),l())}function oi(e,o){if(e&1&&h(0,ni,2,0,"div",22),e&2){let t=s();_(t.reloadingIndicator()?0:-1)}}var gn=(()=>{class e{constructor(){this.aiHelperService=m(he),this.globalWidgetConfigService=m(ue),this.genericWidgetGlobalService=m(pe),this.mdsService=m(Lt),this.toast=m(me),this.topicPageHelperService=m(fe),this.i18nPrefix="TOPIC_PAGE.WIDGET.AI_WIDGET.",this.defaultNodeId="",this.editMode=Y(!1),this.searchInput=Y(null),this.selectDimensions=new Map,this.swimlaneIndex=-1,this.configChanged=new A,this.embedWidgetClicked=new A,this.internalSearchResultCountChanged=new A,this.aiGeneratedText=M(!1),this.disabled=M(!1),this.initialized=M(!1),this.latestSelectedDimensionValues={},this.latestStoredPrompt="",this.latestStoredTexts=[],this.processPromptInProgress=!1,this.promptInput="",this.reloadingIndicator=M(!1),this.resultInput="",this.resultString="",this.updateInProgress=M(!1),this.dimensionPrefix="{{var(",this.dimensionSuffix=")|-}}",this.MdsWidgetType=Ft,this.selectedVariables=Wt(this.topicPageHelperService.getSelectedVariables$(),{initialValue:{}}),this.mds=this.genericWidgetGlobalService.getDefaultMds(),pt(()=>{let t=this.editMode();this.selectedVariables(),this.initialized()&&(this.reloadingIndicator.set(!0),this.editModeDisplayAction(t).then(()=>{this.reloadingIndicator.set(!1)}).catch(i=>{console.error("KI Widget: An error occurred",i)}))})}get availableSelectDimensionKeys(){return Array.from(this.selectDimensions.keys())}get selectDimensionKeysUsed(){return this.availableSelectDimensionKeys.filter(t=>this.latestStoredPrompt.includes(t))}editModeDisplayAction(t){return f(this,null,function*(){t||(yield this.retrieveTextOrRequestAiGeneration())})}retrieveTextOrRequestAiGeneration(){return f(this,null,function*(){let t=this.retrieveExistingValueForSelection(this.latestStoredTexts,this.selectedVariables(),!0);t!==-1&&(this.resultString=this.latestStoredTexts?.[t]?.textValue?.text,this.aiGeneratedText.set(!1)),(t===-1||!this.resultString)&&(yield this.executePrompt(),this.aiGeneratedText.set(!0))})}embedWidget(){this.embedWidgetClicked.emit()}updateSearchResults(t){this.internalSearchResultCountChanged.emit(t)}processPromptUpdate(){return f(this,null,function*(){this.processPromptInProgress=!0,this.latestStoredTexts=[],this.latestSelectedDimensionValues={},this.latestStoredPrompt="",this.resultInput="",this.latestStoredPrompt=this.promptInput,this.configChanged.emit(),setTimeout(()=>f(this,null,function*(){yield this.editModeDisplayAction(this.editMode()),this.processPromptInProgress=!1}),5e3)})}generateTextForSelection(){return f(this,null,function*(){this.disabled.set(!0),this.toast.show({message:this.i18nPrefix+"GENERATE_TEXT_HINT",type:"info",subtype:tt.InfoSimple});let t={};Object.keys(this.latestSelectedDimensionValues).forEach(i=>{this.latestSelectedDimensionValues[i].length>0&&(t[i]=this.latestSelectedDimensionValues[i])}),yield this.executePrompt(t)})}executePrompt(){return f(this,arguments,function*(t={}){let i=it(this.defaultNodeId,this.globalWidgetConfigService.defaultAiTextWidgetConfigId),n=this.selectedVariables();Object.keys(t).length&&(n=t);let a={type:"node",nodeId:_e(this.nodeId||this.propagatedNodeId),configName:"prompt"},c=yield this.aiHelperService.generateFromPrompt(this.nodeId||this.propagatedNodeId?a:i,n,this.contextNodeId);this.resultString=ge(c),this.disabled.set(!1),this.editMode()&&Object.keys(t).length&&(this.resultInput=this.resultString)})}saveModification(){return f(this,null,function*(){let t={};this.selectDimensions.forEach((c,v)=>{this.latestSelectedDimensionValues[v].length&&(t[v]=this.latestSelectedDimensionValues[v])});let i=yield this.aiHelperService.getCurrentUser();t.textValue={text:this.resultInput,updatedAt:Date.now(),updatedBy:i};let n=this.retrieveExistingValueForSelection(this.latestStoredTexts,this.selectedVariables(),!0),a=this.latestStoredTexts??[];n!==-1?a[n]=t:a.push(t),this.latestStoredTexts=a,this.configChanged.emit()})}appendDimensionKey(t){let i=this.promptInput,n=/\s$/,a=this.dimensionPrefix+t+this.dimensionSuffix,c=n.test(i)?a:" "+a;this.promptInput=i+c,this.promptTextarea?.nativeElement?.focus()}checkForPromptChanges(){this.promptInput!==this.latestStoredPrompt&&this.toast.show({message:this.i18nPrefix+"PROMPT_ADJUSTED_HINT",type:"info",subtype:tt.InfoSimple})}preLoadAction(){return f(this,null,function*(){let t=it(this.defaultNodeId,this.globalWidgetConfigService.defaultAiTextWidgetConfigId),n=(yield st(this.mdsService.getMetadataSet({metadataSet:this.genericWidgetGlobalService.getDefaultMds()}))).aiConfigs.find(a=>a.id===t);if(n.prompt=typeof n.prompt=="string"?JSON.parse(n.prompt):n.prompt,n){let a={prompt:n};this.latestStoredPrompt=et(a,"prompt"),this.promptInput=this.latestStoredPrompt}})}setWidgetValues(t,i){return f(this,null,function*(){let n=i&&Object.keys(i)?.length?et(i,"prompt"):t?.prompt??"";n&&(this.latestStoredPrompt=n,this.promptInput=this.latestStoredPrompt),this.latestStoredTexts=t?.texts??[]})}retrieveWidgetConfig(){return{prompt:this.latestStoredPrompt,texts:this.latestStoredTexts}}retrieveCustomAiKeyValuePairs(){return{prompt:this.promptInput}}postLoadAction(){return f(this,null,function*(){yield this.editModeDisplayAction(this.editMode()),this.initialized.set(!0)})}updateResultInput(){let t={};this.selectDimensions.forEach((n,a)=>{this.latestSelectedDimensionValues[a]?.length&&(t[a]=this.latestSelectedDimensionValues[a])});let i=this.retrieveExistingValueForSelection(this.latestStoredTexts,t,!0);i!==-1?this.resultInput=this.latestStoredTexts[i].textValue.text:this.resultInput=""}retrieveExistingValueForSelection(t,i,n=!1){if(!Object.keys(i).length)return-1;let a=Object.values(i).reduce((D,N)=>D+N.length,0),c=0,v=-1,I=Number.MAX_VALUE;for(let D=0;D<t.length;D++){let N=t[D],R=Object.entries(N).filter(([w])=>w!=="textValue").reduce((w,[,V])=>w+(Array.isArray(V)?V.length:0),0),S=0;for(let[w,V]of Object.entries(i)){let Se=N[w]||[];V.forEach(Ie=>{Se.includes(Ie)&&S++})}if(S>0&&S>=c&&((S>c||R<I)&&(c=S,v=D,I=R),S===a&&R===a))return D}return n?-1:v}static{this.\u0275fac=function(i){return new(i||e)}}static{this.\u0275cmp=F({type:e,selectors:[["es-ai-text-widget"]],viewQuery:function(i,n){if(i&1&&xt(We,5),i&2){let a;bt(a=yt())&&(n.promptTextarea=a.first)}},inputs:{contextNodeId:"contextNodeId",defaultNodeId:"defaultNodeId",editMode:[1,"editMode"],embedConfigurationOption:"embedConfigurationOption",gridIndex:"gridIndex",nodeId:"nodeId",pageVariantNode:"pageVariantNode",propagatedNodeId:"propagatedNodeId",searchInput:[1,"searchInput"],selectDimensions:"selectDimensions",swimlaneIndex:"swimlaneIndex"},outputs:{configChanged:"configChanged",embedWidgetClicked:"embedWidgetClicked",internalSearchResultCountChanged:"internalSearchResultCountChanged"},decls:4,vars:1,consts:[["loadingSpinner",""],["promptTextarea",""],[1,"ai-widget"],[1,"edit-mode"],[4,"ngTemplateOutlet"],[1,"mat-heading-4"],[1,"prompt-description"],["appearance","outline"],["matInput","","rows","3",3,"ngModelChange","change","placeholder","ngModel","ngModelOptions"],["mat-flat-button","","color","primary",3,"click","disabled"],[1,"answers-container"],[3,"applyTextareaPadding","disabled","editable","label","inputLimit","nonEditText","showMoreLimit","text"],[3,"optionOneClicked","optionOne","pageVariantNode","swimlaneIndex"],[3,"click"],[1,"select-dimensions",3,"topic-page-grid-cols-1","topic-page-grid-cols-2","topic-page-grid-cols-3"],[1,"select-dimensions"],["ngDefaultControl","",3,"editorMode","mds","widgetId","customAttributes","ngModel"],["ngDefaultControl","",3,"ngModelChange","editorMode","mds","widgetId","customAttributes","ngModel"],[3,"textChange","applyTextareaPadding","disabled","editable","label","inputLimit","nonEditText","showMoreLimit","text"],[3,"aiGenerated","editable","label","nonEditText","searchInput","text"],[3,"searchResultsUpdated","aiGenerated","editable","label","nonEditText","searchInput","text"],[1,"empty-result-string"],[1,"reloading-indicator"]],template:function(i,n){i&1&&(h(0,ti,4,2,"div",2)(1,ii,1,1),E(2,oi,1,1,"ng-template",null,0,Pt)),i&2&&_(n.initialized()?0:1)},dependencies:[Ot,wt,Ce,ee,Jt,Zt,te,Kt,Ut,De,ae,oe,ne,re,se,le,ce,de,ie,Yt,Nt,xe,Et],styles:[".ai-widget[_ngcontent-%COMP%]{min-height:40px;display:flex;flex-direction:column;align-items:flex-start}.ai-widget[_ngcontent-%COMP%]   h2[_ngcontent-%COMP%]{width:100%;text-align:center}.ai-widget[_ngcontent-%COMP%]   es-editable-text[_ngcontent-%COMP%]{width:100%}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]{margin-top:16px;display:flex;flex-direction:column;gap:16px}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   mat-form-field[_ngcontent-%COMP%]{width:100%;display:block}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .prompt-description[_ngcontent-%COMP%]   code[_ngcontent-%COMP%]{cursor:pointer}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .select-dimensions[_ngcontent-%COMP%]{display:grid;place-items:center;gap:.5rem}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .select-dimensions.topic-page-grid-cols-1[_ngcontent-%COMP%]{grid-template-columns:repeat(1,minmax(0,1fr))}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .select-dimensions.topic-page-grid-cols-2[_ngcontent-%COMP%]{grid-template-columns:repeat(2,minmax(0,1fr))}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .select-dimensions.topic-page-grid-cols-3[_ngcontent-%COMP%]{grid-template-columns:repeat(3,minmax(0,1fr))}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .select-dimensions[_ngcontent-%COMP%]   es-mds-editor-single-widget[_ngcontent-%COMP%]{width:100%}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .select-dimensions[_ngcontent-%COMP%]   es-mds-editor-single-widget[_ngcontent-%COMP%]  .mat-mdc-form-field-subscript-wrapper{display:none}.ai-widget[_ngcontent-%COMP%]   .edit-mode[_ngcontent-%COMP%]   .answers-container[_ngcontent-%COMP%]{margin-top:25px}.ai-widget[_ngcontent-%COMP%]   .placeholder-btn[_ngcontent-%COMP%]{margin-bottom:20px}.ai-widget[_ngcontent-%COMP%]   .empty-result-string[_ngcontent-%COMP%]{padding:8px 16px 16px}.ai-widget[_ngcontent-%COMP%]   .reloading-indicator[_ngcontent-%COMP%]{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:wait;background:#0006}[_nghost-%COMP%]     es-spinner .spinner{width:150px}"]})}}return e})();export{gn as AiTextWidgetComponent};
