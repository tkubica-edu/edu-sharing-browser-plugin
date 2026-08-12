import{b as Ci}from"./chunk-TV2Z6QBC.js";import{a as ki}from"./chunk-INOTS3ZQ.js";import{a as bi}from"./chunk-Y73H2HTO.js";import{$ as vi,K as fi,M as xi}from"./chunk-NDA7BY3P.js";import"./chunk-VZBF6OYS.js";import{Da as ui}from"./chunk-TZJCNC5W.js";import"./chunk-S4UUG6VS.js";import"./chunk-JHF4YUSV.js";import{b as gi}from"./chunk-SRGBI42A.js";import{Ab as mi,Jb as di,Kb as hi,fb as li,m as ni,tb as si,ub as ri,xa as oi,xd as pi,yc as ht}from"./chunk-63VBACCJ.js";import{a as ai}from"./chunk-5QAKBGIR.js";import{a as _i}from"./chunk-SEQMXY75.js";import{d as $t}from"./chunk-7SRXXGKM.js";import{$ as Gt,Ba as Jt,Ca as ti,Ea as ii,Ga as tt,Ha as ei,L as qt,Qb as ci,R as Ht,V as Qt,X as Wt,ca as Kt,da as Xt,ja as Zt,la as Yt,m as J,n as Ut,za as S}from"./chunk-VP5IMJJH.js";import{$b as C,Aa as Q,Ac as p,Bc as s,C as E,Ca as W,Cb as lt,Cc as m,Cd as g,Dc as b,Dd as u,Ea as _,Fb as Dt,Gd as z,Hb as l,Jc as q,Ka as P,La as I,M as Mt,Ma as Et,Mc as V,Na as At,Oa as Ft,Pd as jt,Rc as x,Sa as A,Sb as Rt,T as Ot,Ta as ct,Uc as c,Vc as st,Wa as F,Wc as B,Wd as dt,Xc as Y,Yc as Nt,Zb as N,Zc as D,_b as K,_c as R,a as nt,ac as zt,b as ot,bb as Bt,bc as $,cb as G,cc as f,cd as k,dd as Vt,eb as L,ed as w,fa as Tt,hd as y,i as kt,j as Ct,jd as M,l as wt,ma as Pt,o as yt,p as H,pa as It,ra as at,rc as v,ta as Lt,tc as d,ud as rt,v as U,vc as h,xd as mt,ya as St,yc as X,zc as Z}from"./chunk-SISH7RCI.js";var wi=(()=>{class i{static \u0275fac=function(e){return new(e||i)};static \u0275mod=K({type:i});static \u0275inj=Q({imports:[tt]})}return i})();var Ri=["*"],zi=`.mdc-list {
  margin: 0;
  padding: 8px 0;
  list-style-type: none;
}
.mdc-list:focus {
  outline: none;
}

.mdc-list-item {
  display: flex;
  position: relative;
  justify-content: flex-start;
  overflow: hidden;
  padding: 0;
  align-items: stretch;
  cursor: pointer;
  padding-left: 16px;
  padding-right: 16px;
  background-color: var(--mat-list-list-item-container-color, transparent);
  border-radius: var(--mat-list-list-item-container-shape, var(--mat-sys-corner-none));
}
.mdc-list-item.mdc-list-item--selected {
  background-color: var(--mat-list-list-item-selected-container-color);
}
.mdc-list-item:focus {
  outline: 0;
}
.mdc-list-item.mdc-list-item--disabled {
  cursor: auto;
}
.mdc-list-item.mdc-list-item--with-one-line {
  height: var(--mat-list-list-item-one-line-container-height, 48px);
}
.mdc-list-item.mdc-list-item--with-one-line .mdc-list-item__start {
  align-self: center;
  margin-top: 0;
}
.mdc-list-item.mdc-list-item--with-one-line .mdc-list-item__end {
  align-self: center;
  margin-top: 0;
}
.mdc-list-item.mdc-list-item--with-two-lines {
  height: var(--mat-list-list-item-two-line-container-height, 64px);
}
.mdc-list-item.mdc-list-item--with-two-lines .mdc-list-item__start {
  align-self: flex-start;
  margin-top: 16px;
}
.mdc-list-item.mdc-list-item--with-two-lines .mdc-list-item__end {
  align-self: center;
  margin-top: 0;
}
.mdc-list-item.mdc-list-item--with-three-lines {
  height: var(--mat-list-list-item-three-line-container-height, 88px);
}
.mdc-list-item.mdc-list-item--with-three-lines .mdc-list-item__start {
  align-self: flex-start;
  margin-top: 16px;
}
.mdc-list-item.mdc-list-item--with-three-lines .mdc-list-item__end {
  align-self: flex-start;
  margin-top: 16px;
}
.mdc-list-item.mdc-list-item--selected::before, .mdc-list-item.mdc-list-item--selected:focus::before, .mdc-list-item:not(.mdc-list-item--selected):focus::before {
  position: absolute;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  content: "";
  pointer-events: none;
}

a.mdc-list-item {
  color: inherit;
  text-decoration: none;
}

.mdc-list-item__start {
  fill: currentColor;
  flex-shrink: 0;
  pointer-events: none;
}
.mdc-list-item--with-leading-icon .mdc-list-item__start {
  color: var(--mat-list-list-item-leading-icon-color, var(--mat-sys-on-surface-variant));
  width: var(--mat-list-list-item-leading-icon-size, 24px);
  height: var(--mat-list-list-item-leading-icon-size, 24px);
  margin-left: 16px;
  margin-right: 32px;
}
[dir=rtl] .mdc-list-item--with-leading-icon .mdc-list-item__start {
  margin-left: 32px;
  margin-right: 16px;
}
.mdc-list-item--with-leading-icon:hover .mdc-list-item__start {
  color: var(--mat-list-list-item-hover-leading-icon-color);
}
.mdc-list-item--with-leading-avatar .mdc-list-item__start {
  width: var(--mat-list-list-item-leading-avatar-size, 40px);
  height: var(--mat-list-list-item-leading-avatar-size, 40px);
  margin-left: 16px;
  margin-right: 16px;
  border-radius: 50%;
}
.mdc-list-item--with-leading-avatar .mdc-list-item__start, [dir=rtl] .mdc-list-item--with-leading-avatar .mdc-list-item__start {
  margin-left: 16px;
  margin-right: 16px;
  border-radius: 50%;
}

.mdc-list-item__end {
  flex-shrink: 0;
  pointer-events: none;
}
.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  font-family: var(--mat-list-list-item-trailing-supporting-text-font, var(--mat-sys-label-small-font));
  line-height: var(--mat-list-list-item-trailing-supporting-text-line-height, var(--mat-sys-label-small-line-height));
  font-size: var(--mat-list-list-item-trailing-supporting-text-size, var(--mat-sys-label-small-size));
  font-weight: var(--mat-list-list-item-trailing-supporting-text-weight, var(--mat-sys-label-small-weight));
  letter-spacing: var(--mat-list-list-item-trailing-supporting-text-tracking, var(--mat-sys-label-small-tracking));
}
.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  color: var(--mat-list-list-item-trailing-icon-color, var(--mat-sys-on-surface-variant));
  width: var(--mat-list-list-item-trailing-icon-size, 24px);
  height: var(--mat-list-list-item-trailing-icon-size, 24px);
}
.mdc-list-item--with-trailing-icon:hover .mdc-list-item__end {
  color: var(--mat-list-list-item-hover-trailing-icon-color);
}
.mdc-list-item.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  color: var(--mat-list-list-item-trailing-supporting-text-color, var(--mat-sys-on-surface-variant));
}
.mdc-list-item--selected.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  color: var(--mat-list-list-item-selected-trailing-icon-color, var(--mat-sys-primary));
}

.mdc-list-item__content {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  align-self: center;
  flex: 1;
  pointer-events: none;
}
.mdc-list-item--with-two-lines .mdc-list-item__content, .mdc-list-item--with-three-lines .mdc-list-item__content {
  align-self: stretch;
}

.mdc-list-item__primary-text {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  color: var(--mat-list-list-item-label-text-color, var(--mat-sys-on-surface));
  font-family: var(--mat-list-list-item-label-text-font, var(--mat-sys-body-large-font));
  line-height: var(--mat-list-list-item-label-text-line-height, var(--mat-sys-body-large-line-height));
  font-size: var(--mat-list-list-item-label-text-size, var(--mat-sys-body-large-size));
  font-weight: var(--mat-list-list-item-label-text-weight, var(--mat-sys-body-large-weight));
  letter-spacing: var(--mat-list-list-item-label-text-tracking, var(--mat-sys-body-large-tracking));
}
.mdc-list-item:hover .mdc-list-item__primary-text {
  color: var(--mat-list-list-item-hover-label-text-color, var(--mat-sys-on-surface));
}
.mdc-list-item:focus .mdc-list-item__primary-text {
  color: var(--mat-list-list-item-focus-label-text-color, var(--mat-sys-on-surface));
}
.mdc-list-item--with-two-lines .mdc-list-item__primary-text, .mdc-list-item--with-three-lines .mdc-list-item__primary-text {
  display: block;
  margin-top: 0;
  line-height: normal;
  margin-bottom: -20px;
}
.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before, .mdc-list-item--with-three-lines .mdc-list-item__primary-text::before {
  display: inline-block;
  width: 0;
  height: 28px;
  content: "";
  vertical-align: 0;
}
.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after, .mdc-list-item--with-three-lines .mdc-list-item__primary-text::after {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: -20px;
}

.mdc-list-item__secondary-text {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  display: block;
  margin-top: 0;
  color: var(--mat-list-list-item-supporting-text-color, var(--mat-sys-on-surface-variant));
  font-family: var(--mat-list-list-item-supporting-text-font, var(--mat-sys-body-medium-font));
  line-height: var(--mat-list-list-item-supporting-text-line-height, var(--mat-sys-body-medium-line-height));
  font-size: var(--mat-list-list-item-supporting-text-size, var(--mat-sys-body-medium-size));
  font-weight: var(--mat-list-list-item-supporting-text-weight, var(--mat-sys-body-medium-weight));
  letter-spacing: var(--mat-list-list-item-supporting-text-tracking, var(--mat-sys-body-medium-tracking));
}
.mdc-list-item__secondary-text::before {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: 0;
}
.mdc-list-item--with-three-lines .mdc-list-item__secondary-text {
  white-space: normal;
  line-height: 20px;
}
.mdc-list-item--with-overline .mdc-list-item__secondary-text {
  white-space: nowrap;
  line-height: auto;
}

.mdc-list-item--with-leading-radio.mdc-list-item,
.mdc-list-item--with-leading-checkbox.mdc-list-item,
.mdc-list-item--with-leading-icon.mdc-list-item,
.mdc-list-item--with-leading-avatar.mdc-list-item {
  padding-left: 0;
  padding-right: 16px;
}
[dir=rtl] .mdc-list-item--with-leading-radio.mdc-list-item,
[dir=rtl] .mdc-list-item--with-leading-checkbox.mdc-list-item,
[dir=rtl] .mdc-list-item--with-leading-icon.mdc-list-item,
[dir=rtl] .mdc-list-item--with-leading-avatar.mdc-list-item {
  padding-left: 16px;
  padding-right: 0;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__primary-text,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__primary-text,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines .mdc-list-item__primary-text,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text {
  display: block;
  margin-top: 0;
  line-height: normal;
  margin-bottom: -20px;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before {
  display: inline-block;
  width: 0;
  height: 32px;
  content: "";
  vertical-align: 0;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: -20px;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  display: block;
  margin-top: 0;
  line-height: normal;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before {
  display: inline-block;
  width: 0;
  height: 32px;
  content: "";
  vertical-align: 0;
}

.mdc-list-item--with-trailing-icon.mdc-list-item, [dir=rtl] .mdc-list-item--with-trailing-icon.mdc-list-item {
  padding-left: 0;
  padding-right: 0;
}
.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  margin-left: 16px;
  margin-right: 16px;
}

.mdc-list-item--with-trailing-meta.mdc-list-item {
  padding-left: 16px;
  padding-right: 0;
}
[dir=rtl] .mdc-list-item--with-trailing-meta.mdc-list-item {
  padding-left: 0;
  padding-right: 16px;
}
.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  -webkit-user-select: none;
  user-select: none;
  margin-left: 28px;
  margin-right: 16px;
}
[dir=rtl] .mdc-list-item--with-trailing-meta .mdc-list-item__end {
  margin-left: 16px;
  margin-right: 28px;
}
.mdc-list-item--with-trailing-meta.mdc-list-item--with-three-lines .mdc-list-item__end, .mdc-list-item--with-trailing-meta.mdc-list-item--with-two-lines .mdc-list-item__end {
  display: block;
  line-height: normal;
  align-self: flex-start;
  margin-top: 0;
}
.mdc-list-item--with-trailing-meta.mdc-list-item--with-three-lines .mdc-list-item__end::before, .mdc-list-item--with-trailing-meta.mdc-list-item--with-two-lines .mdc-list-item__end::before {
  display: inline-block;
  width: 0;
  height: 28px;
  content: "";
  vertical-align: 0;
}

.mdc-list-item--with-leading-radio .mdc-list-item__start,
.mdc-list-item--with-leading-checkbox .mdc-list-item__start {
  margin-left: 8px;
  margin-right: 24px;
}
[dir=rtl] .mdc-list-item--with-leading-radio .mdc-list-item__start,
[dir=rtl] .mdc-list-item--with-leading-checkbox .mdc-list-item__start {
  margin-left: 24px;
  margin-right: 8px;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__start,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__start {
  align-self: flex-start;
  margin-top: 8px;
}

.mdc-list-item--with-trailing-radio.mdc-list-item,
.mdc-list-item--with-trailing-checkbox.mdc-list-item {
  padding-left: 16px;
  padding-right: 0;
}
[dir=rtl] .mdc-list-item--with-trailing-radio.mdc-list-item,
[dir=rtl] .mdc-list-item--with-trailing-checkbox.mdc-list-item {
  padding-left: 0;
  padding-right: 16px;
}
.mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-icon, .mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-avatar,
.mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-icon,
.mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-avatar {
  padding-left: 0;
}
[dir=rtl] .mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-icon, [dir=rtl] .mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-avatar,
[dir=rtl] .mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-icon,
[dir=rtl] .mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-avatar {
  padding-right: 0;
}
.mdc-list-item--with-trailing-radio .mdc-list-item__end,
.mdc-list-item--with-trailing-checkbox .mdc-list-item__end {
  margin-left: 24px;
  margin-right: 8px;
}
[dir=rtl] .mdc-list-item--with-trailing-radio .mdc-list-item__end,
[dir=rtl] .mdc-list-item--with-trailing-checkbox .mdc-list-item__end {
  margin-left: 8px;
  margin-right: 24px;
}
.mdc-list-item--with-trailing-radio.mdc-list-item--with-three-lines .mdc-list-item__end,
.mdc-list-item--with-trailing-checkbox.mdc-list-item--with-three-lines .mdc-list-item__end {
  align-self: flex-start;
  margin-top: 8px;
}

.mdc-list-group__subheader {
  margin: 0.75rem 16px;
}

.mdc-list-item--disabled .mdc-list-item__start,
.mdc-list-item--disabled .mdc-list-item__content,
.mdc-list-item--disabled .mdc-list-item__end {
  opacity: 1;
}
.mdc-list-item--disabled .mdc-list-item__primary-text,
.mdc-list-item--disabled .mdc-list-item__secondary-text {
  opacity: var(--mat-list-list-item-disabled-label-text-opacity, 0.3);
}
.mdc-list-item--disabled.mdc-list-item--with-leading-icon .mdc-list-item__start {
  color: var(--mat-list-list-item-disabled-leading-icon-color, var(--mat-sys-on-surface));
  opacity: var(--mat-list-list-item-disabled-leading-icon-opacity, 0.38);
}
.mdc-list-item--disabled.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  color: var(--mat-list-list-item-disabled-trailing-icon-color, var(--mat-sys-on-surface));
  opacity: var(--mat-list-list-item-disabled-trailing-icon-opacity, 0.38);
}

.mat-mdc-list-item.mat-mdc-list-item-both-leading-and-trailing, [dir=rtl] .mat-mdc-list-item.mat-mdc-list-item-both-leading-and-trailing {
  padding-left: 0;
  padding-right: 0;
}

.mdc-list-item.mdc-list-item--disabled .mdc-list-item__primary-text {
  color: var(--mat-list-list-item-disabled-label-text-color, var(--mat-sys-on-surface));
}

.mdc-list-item:hover::before {
  background-color: var(--mat-list-list-item-hover-state-layer-color, var(--mat-sys-on-surface));
  opacity: var(--mat-list-list-item-hover-state-layer-opacity, var(--mat-sys-hover-state-layer-opacity));
}

.mdc-list-item.mdc-list-item--disabled::before {
  background-color: var(--mat-list-list-item-disabled-state-layer-color, var(--mat-sys-on-surface));
  opacity: var(--mat-list-list-item-disabled-state-layer-opacity, var(--mat-sys-focus-state-layer-opacity));
}

.mdc-list-item:focus::before {
  background-color: var(--mat-list-list-item-focus-state-layer-color, var(--mat-sys-on-surface));
  opacity: var(--mat-list-list-item-focus-state-layer-opacity, var(--mat-sys-focus-state-layer-opacity));
}

.mdc-list-item--disabled .mdc-radio,
.mdc-list-item--disabled .mdc-checkbox {
  opacity: var(--mat-list-list-item-disabled-label-text-opacity, 0.3);
}

.mdc-list-item--with-leading-avatar .mat-mdc-list-item-avatar {
  border-radius: var(--mat-list-list-item-leading-avatar-shape, var(--mat-sys-corner-full));
  background-color: var(--mat-list-list-item-leading-avatar-color, var(--mat-sys-primary-container));
}

.mat-mdc-list-item-icon {
  font-size: var(--mat-list-list-item-leading-icon-size, 24px);
}

@media (forced-colors: active) {
  a.mdc-list-item--activated::after {
    content: "";
    position: absolute;
    top: 50%;
    right: 16px;
    transform: translateY(-50%);
    width: 10px;
    height: 0;
    border-bottom: solid 10px;
    border-radius: 10px;
  }
  a.mdc-list-item--activated [dir=rtl]::after {
    right: auto;
    left: 16px;
  }
}

.mat-mdc-list-base {
  display: block;
}
.mat-mdc-list-base .mdc-list-item__start,
.mat-mdc-list-base .mdc-list-item__end,
.mat-mdc-list-base .mdc-list-item__content {
  pointer-events: auto;
}

.mat-mdc-list-item,
.mat-mdc-list-option {
  width: 100%;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}
.mat-mdc-list-item:not(.mat-mdc-list-item-interactive),
.mat-mdc-list-option:not(.mat-mdc-list-item-interactive) {
  cursor: default;
}
.mat-mdc-list-item .mat-divider-inset,
.mat-mdc-list-option .mat-divider-inset {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.mat-mdc-list-item .mat-mdc-list-item-avatar ~ .mat-divider-inset,
.mat-mdc-list-option .mat-mdc-list-item-avatar ~ .mat-divider-inset {
  margin-left: 72px;
}
[dir=rtl] .mat-mdc-list-item .mat-mdc-list-item-avatar ~ .mat-divider-inset,
[dir=rtl] .mat-mdc-list-option .mat-mdc-list-item-avatar ~ .mat-divider-inset {
  margin-right: 72px;
}

.mat-mdc-list-item-interactive::before {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  position: absolute;
  content: "";
  opacity: 0;
  pointer-events: none;
  border-radius: inherit;
}

.mat-mdc-list-item > .mat-focus-indicator {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  position: absolute;
  pointer-events: none;
}
.mat-mdc-list-item:focus-visible > .mat-focus-indicator::before {
  content: "";
}

.mat-mdc-list-item.mdc-list-item--with-three-lines .mat-mdc-list-item-line.mdc-list-item__secondary-text {
  white-space: nowrap;
  line-height: normal;
}
.mat-mdc-list-item.mdc-list-item--with-three-lines .mat-mdc-list-item-unscoped-content.mdc-list-item__secondary-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

mat-action-list button {
  background: none;
  color: inherit;
  border: none;
  font: inherit;
  outline: inherit;
  -webkit-tap-highlight-color: transparent;
  text-align: start;
}
mat-action-list button::-moz-focus-inner {
  border: 0;
}

.mdc-list-item--with-leading-icon .mdc-list-item__start {
  margin-inline-start: var(--mat-list-list-item-leading-icon-start-space, 16px);
  margin-inline-end: var(--mat-list-list-item-leading-icon-end-space, 16px);
}

.mat-mdc-nav-list .mat-mdc-list-item {
  border-radius: var(--mat-list-active-indicator-shape, var(--mat-sys-corner-full));
  --mat-focus-indicator-border-radius: var(--mat-list-active-indicator-shape, var(--mat-sys-corner-full));
}
.mat-mdc-nav-list .mat-mdc-list-item.mdc-list-item--activated {
  background-color: var(--mat-list-active-indicator-color, var(--mat-sys-secondary-container));
}
`,Ni=["unscopedContent"];var Vi=[[["","matListItemTitle",""]],[["","matListItemLine",""]],"*",[["mat-divider"]],[["","matListItemAvatar",""],["","matListItemIcon",""]]],ji=["[matListItemTitle]","[matListItemLine]","*","mat-divider","[matListItemAvatar],[matListItemIcon]"];function Ui(i,o){i&1&&B(0,4)}function $i(i,o){if(i&1&&(s(0,"div",11),b(1,"input",12),s(2,"div",13),Et(),s(3,"svg",14),b(4,"path",15),m(),At(),b(5,"div",16),m()()),i&2){let t=c();w("mdc-checkbox--disabled",t.disabled),l(),p("checked",t.selected)("disabled",t.disabled)}}function qi(i,o){if(i&1&&(s(0,"div",17),b(1,"input",18),s(2,"div",19),b(3,"div",20)(4,"div",21),m()()),i&2){let t=c();w("mdc-radio--disabled",t.disabled),l(),p("checked",t.selected)("disabled",t.disabled)}}function Hi(i,o){}function Qi(i,o){if(i&1&&(s(0,"span",4),f(1,Hi,0,0,"ng-template",6),m()),i&2){c();let t=k(3);l(),p("ngTemplateOutlet",t)}}function Wi(i,o){}function Gi(i,o){if(i&1&&(s(0,"span",5),f(1,Wi,0,0,"ng-template",6),m()),i&2){c();let t=k(5);l(),p("ngTemplateOutlet",t)}}function Ki(i,o){}function Xi(i,o){if(i&1&&f(0,Ki,0,0,"ng-template",6),i&2){c();let t=k(1);p("ngTemplateOutlet",t)}}function Zi(i,o){}function Yi(i,o){if(i&1&&(s(0,"span",9),f(1,Zi,0,0,"ng-template",6),m()),i&2){c();let t=k(3);l(),p("ngTemplateOutlet",t)}}function Ji(i,o){}function te(i,o){if(i&1&&(s(0,"span",9),f(1,Ji,0,0,"ng-template",6),m()),i&2){c();let t=k(5);l(),p("ngTemplateOutlet",t)}}function ie(i,o){}function ee(i,o){if(i&1&&f(0,ie,0,0,"ng-template",6),i&2){c();let t=k(1);p("ngTemplateOutlet",t)}}var Mi=new W("ListOption"),gt=(()=>{class i{_elementRef=_(L);constructor(){}static \u0275fac=function(e){return new(e||i)};static \u0275dir=C({type:i,selectors:[["","matListItemTitle",""]],hostAttrs:[1,"mat-mdc-list-item-title","mdc-list-item__primary-text"]})}return i})(),ne=(()=>{class i{_elementRef=_(L);constructor(){}static \u0275fac=function(e){return new(e||i)};static \u0275dir=C({type:i,selectors:[["","matListItemLine",""]],hostAttrs:[1,"mat-mdc-list-item-line","mdc-list-item__secondary-text"]})}return i})();var Oi=(()=>{class i{_listOption=_(Mi,{optional:!0});constructor(){}_isAlignedAtStart(){return!this._listOption||this._listOption?._getTogglePosition()==="after"}static \u0275fac=function(e){return new(e||i)};static \u0275dir=C({type:i,hostVars:4,hostBindings:function(e,n){e&2&&w("mdc-list-item__start",n._isAlignedAtStart())("mdc-list-item__end",!n._isAlignedAtStart())}})}return i})(),oe=(()=>{class i extends Oi{static \u0275fac=(()=>{let t;return function(n){return(t||(t=G(i)))(n||i)}})();static \u0275dir=C({type:i,selectors:[["","matListItemAvatar",""]],hostAttrs:[1,"mat-mdc-list-item-avatar"],features:[$]})}return i})(),ae=(()=>{class i extends Oi{static \u0275fac=(()=>{let t;return function(n){return(t||(t=G(i)))(n||i)}})();static \u0275dir=C({type:i,selectors:[["","matListItemIcon",""]],hostAttrs:[1,"mat-mdc-list-item-icon"],features:[$]})}return i})(),ce=new W("MAT_LIST_CONFIG"),_t=(()=>{class i{_isNonInteractive=!0;get disableRipple(){return this._disableRipple}set disableRipple(t){this._disableRipple=S(t)}_disableRipple=!1;get disabled(){return this._disabled()}set disabled(t){this._disabled.set(S(t))}_disabled=F(!1);_defaultOptions=_(ce,{optional:!0});static \u0275fac=function(e){return new(e||i)};static \u0275dir=C({type:i,hostVars:1,hostBindings:function(e,n){e&2&&v("aria-disabled",n.disabled)},inputs:{disableRipple:"disableRipple",disabled:"disabled"}})}return i})(),yi=(()=>{class i{_elementRef=_(L);_ngZone=_(ct);_listBase=_(_t,{optional:!0});_platform=_(qt);_hostElement;_isButtonElement;_noopAnimations=Ht();_avatars;_icons;set lines(t){this._explicitLines=Wt(t,null),this._updateItemLines(!1)}_explicitLines=null;get disableRipple(){return this.disabled||this._disableRipple||this._noopAnimations||!!this._listBase?.disableRipple}set disableRipple(t){this._disableRipple=S(t)}_disableRipple=!1;get disabled(){return this._disabled()||!!this._listBase?.disabled}set disabled(t){this._disabled.set(S(t))}_disabled=F(!1);_subscriptions=new Ct;_rippleRenderer=null;_hasUnscopedTextContent=!1;rippleConfig;get rippleDisabled(){return this.disableRipple||!!this.rippleConfig.disabled}constructor(){_(Gt).load(ii);let t=_(ti,{optional:!0});this.rippleConfig=t||{},this._hostElement=this._elementRef.nativeElement,this._isButtonElement=this._hostElement.nodeName.toLowerCase()==="button",this._listBase&&!this._listBase._isNonInteractive&&this._initInteractiveListItem(),this._isButtonElement&&!this._hostElement.hasAttribute("type")&&this._hostElement.setAttribute("type","button")}ngAfterViewInit(){this._monitorProjectedLinesAndTitle(),this._updateItemLines(!0)}ngOnDestroy(){this._subscriptions.unsubscribe(),this._rippleRenderer!==null&&this._rippleRenderer._removeTriggerEvents()}_hasIconOrAvatar(){return!!(this._avatars.length||this._icons.length)}_initInteractiveListItem(){this._hostElement.classList.add("mat-mdc-list-item-interactive"),this._rippleRenderer=new Jt(this,this._ngZone,this._hostElement,this._platform,_(Ft)),this._rippleRenderer.setupTriggerEvents(this._hostElement)}_monitorProjectedLinesAndTitle(){this._ngZone.runOutsideAngular(()=>{this._subscriptions.add(Mt(this._lines.changes,this._titles.changes).subscribe(()=>this._updateItemLines(!1)))})}_updateItemLines(t){if(!this._lines||!this._titles||!this._unscopedContent)return;t&&this._checkDomForUnscopedTextContent();let e=this._explicitLines??this._inferLinesFromContent(),n=this._unscopedContent.nativeElement;if(this._hostElement.classList.toggle("mat-mdc-list-item-single-line",e<=1),this._hostElement.classList.toggle("mdc-list-item--with-one-line",e<=1),this._hostElement.classList.toggle("mdc-list-item--with-two-lines",e===2),this._hostElement.classList.toggle("mdc-list-item--with-three-lines",e===3),this._hasUnscopedTextContent){let a=this._titles.length===0&&e===1;n.classList.toggle("mdc-list-item__primary-text",a),n.classList.toggle("mdc-list-item__secondary-text",!a)}else n.classList.remove("mdc-list-item__primary-text"),n.classList.remove("mdc-list-item__secondary-text")}_inferLinesFromContent(){let t=this._titles.length+this._lines.length;return this._hasUnscopedTextContent&&(t+=1),t}_checkDomForUnscopedTextContent(){this._hasUnscopedTextContent=Array.from(this._unscopedContent.nativeElement.childNodes).filter(t=>t.nodeType!==t.COMMENT_NODE).some(t=>!!(t.textContent&&t.textContent.trim()))}static \u0275fac=function(e){return new(e||i)};static \u0275dir=C({type:i,contentQueries:function(e,n,a){if(e&1&&Y(a,oe,4)(a,ae,4),e&2){let r;D(r=R())&&(n._avatars=r),D(r=R())&&(n._icons=r)}},hostVars:4,hostBindings:function(e,n){e&2&&(v("aria-disabled",n.disabled)("disabled",n._isButtonElement&&n.disabled||null),w("mdc-list-item--disabled",n.disabled))},inputs:{lines:"lines",disableRipple:"disableRipple",disabled:"disabled"}})}return i})();var Ti=new W("SelectionList"),ut=(()=>{class i extends yi{_selectionList=_(Ti);_changeDetectorRef=_(dt);_lines;_titles;_unscopedContent;selectedChange=new A;togglePosition="after";get checkboxPosition(){return this.togglePosition}set checkboxPosition(t){this.togglePosition=t}get color(){return this._color||this._selectionList.color}set color(t){this._color=t}_color;get value(){return this._value}set value(t){this.selected&&t!==this.value&&this._inputsInitialized&&(this.selected=!1),this._value=t}_value;get selected(){return this._selectionList.selectedOptions.isSelected(this)}set selected(t){let e=S(t);e!==this._selected&&(this._setSelected(e),(e||this._selectionList.multiple)&&this._selectionList._reportValueChange())}_selected=!1;_inputsInitialized=!1;ngOnInit(){let t=this._selectionList;t._value&&t._value.some(n=>t.compareWith(this._value,n))&&this._setSelected(!0);let e=this._selected;Promise.resolve().then(()=>{(this._selected||e)&&(this.selected=!0,this._changeDetectorRef.markForCheck())}),this._inputsInitialized=!0}ngOnDestroy(){super.ngOnDestroy(),this.selected&&Promise.resolve().then(()=>{this.selected=!1})}toggle(){this.selected=!this.selected}focus(){this._hostElement.focus()}getLabel(){return(this._titles?.get(0)?._elementRef.nativeElement||this._unscopedContent?.nativeElement)?.textContent||""}_hasCheckboxAt(t){return this._selectionList.multiple&&this._getTogglePosition()===t}_hasRadioAt(t){return!this._selectionList.multiple&&this._getTogglePosition()===t&&!this._selectionList.hideSingleSelectionIndicator}_hasIconsOrAvatarsAt(t){return this._hasProjected("icons",t)||this._hasProjected("avatars",t)}_hasProjected(t,e){return this._getTogglePosition()!==e&&(t==="avatars"?this._avatars.length!==0:this._icons.length!==0)}_handleBlur(){this._selectionList._onTouched()}_getTogglePosition(){return this.togglePosition||"after"}_setSelected(t){return t===this._selected?!1:(this._selected=t,t?this._selectionList.selectedOptions.select(this):this._selectionList.selectedOptions.deselect(this),this.selectedChange.emit(t),this._changeDetectorRef.markForCheck(),!0)}_markForCheck(){this._changeDetectorRef.markForCheck()}_toggleOnInteraction(){this.disabled||(this._selectionList.multiple?(this.selected=!this.selected,this._selectionList._emitChangeEvent([this])):this.selected||(this.selected=!0,this._selectionList._emitChangeEvent([this])))}_setTabindex(t){this._hostElement.setAttribute("tabindex",t+"")}_hasBothLeadingAndTrailing(){let t=this._hasProjected("avatars","before")||this._hasProjected("icons","before")||this._hasCheckboxAt("before")||this._hasRadioAt("before"),e=this._hasProjected("icons","after")||this._hasProjected("avatars","after")||this._hasCheckboxAt("after")||this._hasRadioAt("after");return t&&e}static \u0275fac=(()=>{let t;return function(n){return(t||(t=G(i)))(n||i)}})();static \u0275cmp=N({type:i,selectors:[["mat-list-option"]],contentQueries:function(e,n,a){if(e&1&&Y(a,ne,5)(a,gt,5),e&2){let r;D(r=R())&&(n._lines=r),D(r=R())&&(n._titles=r)}},viewQuery:function(e,n){if(e&1&&Nt(Ni,5),e&2){let a;D(a=R())&&(n._unscopedContent=a.first)}},hostAttrs:["role","option",1,"mat-mdc-list-item","mat-mdc-list-option","mdc-list-item"],hostVars:27,hostBindings:function(e,n){e&1&&x("blur",function(){return n._handleBlur()})("click",function(){return n._toggleOnInteraction()}),e&2&&(v("aria-selected",n.selected),w("mdc-list-item--selected",n.selected&&!n._selectionList.multiple&&n._selectionList.hideSingleSelectionIndicator)("mdc-list-item--with-leading-avatar",n._hasProjected("avatars","before"))("mdc-list-item--with-leading-icon",n._hasProjected("icons","before"))("mdc-list-item--with-trailing-icon",n._hasProjected("icons","after"))("mat-mdc-list-option-with-trailing-avatar",n._hasProjected("avatars","after"))("mdc-list-item--with-leading-checkbox",n._hasCheckboxAt("before"))("mdc-list-item--with-trailing-checkbox",n._hasCheckboxAt("after"))("mdc-list-item--with-leading-radio",n._hasRadioAt("before"))("mdc-list-item--with-trailing-radio",n._hasRadioAt("after"))("mat-mdc-list-item-both-leading-and-trailing",n._hasBothLeadingAndTrailing())("mat-accent",n.color!=="primary"&&n.color!=="warn")("mat-warn",n.color==="warn")("_mat-animation-noopable",n._noopAnimations))},inputs:{togglePosition:"togglePosition",checkboxPosition:"checkboxPosition",color:"color",value:"value",selected:"selected"},outputs:{selectedChange:"selectedChange"},exportAs:["matListOption"],features:[rt([{provide:yi,useExisting:i},{provide:Mi,useExisting:i}]),$],ngContentSelectors:ji,decls:20,vars:4,consts:[["icons",""],["checkbox",""],["radio",""],["unscopedContent",""],[1,"mdc-list-item__start","mat-mdc-list-option-checkbox-before"],[1,"mdc-list-item__start","mat-mdc-list-option-radio-before"],[3,"ngTemplateOutlet"],[1,"mdc-list-item__content"],[1,"mat-mdc-list-item-unscoped-content",3,"cdkObserveContent"],[1,"mdc-list-item__end"],[1,"mat-focus-indicator"],[1,"mdc-checkbox"],["type","checkbox",1,"mdc-checkbox__native-control",3,"checked","disabled"],[1,"mdc-checkbox__background"],["viewBox","0 0 24 24","aria-hidden","true",1,"mdc-checkbox__checkmark"],["fill","none","d","M1.73,12.91 8.1,19.28 22.79,4.59",1,"mdc-checkbox__checkmark-path"],[1,"mdc-checkbox__mixedmark"],[1,"mdc-radio"],["type","radio",1,"mdc-radio__native-control",3,"checked","disabled"],[1,"mdc-radio__background"],[1,"mdc-radio__outer-circle"],[1,"mdc-radio__inner-circle"]],template:function(e,n){e&1&&(st(Vi),f(0,Ui,1,0,"ng-template",null,0,z)(2,$i,6,4,"ng-template",null,1,z)(4,qi,5,4,"ng-template",null,2,z),d(6,Qi,2,1,"span",4)(7,Gi,2,1,"span",5),d(8,Xi,1,1,null,6),s(9,"span",7),B(10),B(11,1),s(12,"span",8,3),x("cdkObserveContent",function(){return n._updateItemLines(!0)}),B(14,2),m()(),d(15,Yi,2,1,"span",9)(16,te,2,1,"span",9),d(17,ee,1,1,null,6),B(18,3),b(19,"div",10)),e&2&&(l(6),h(n._hasCheckboxAt("before")?6:n._hasRadioAt("before")?7:-1),l(2),h(n._hasIconsOrAvatarsAt("before")?8:-1),l(7),h(n._hasCheckboxAt("after")?15:n._hasRadioAt("after")?16:-1),l(2),h(n._hasIconsOrAvatarsAt("after")?17:-1))},dependencies:[J,Kt],styles:[`.mat-mdc-list-option-with-trailing-avatar.mdc-list-item, [dir=rtl] .mat-mdc-list-option-with-trailing-avatar.mdc-list-item {
  padding-left: 0;
  padding-right: 0;
}
.mat-mdc-list-option-with-trailing-avatar .mdc-list-item__end {
  margin-left: 16px;
  margin-right: 16px;
  width: 40px;
  height: 40px;
}
.mat-mdc-list-option-with-trailing-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text {
  display: block;
  margin-top: 0;
  line-height: normal;
  margin-bottom: -20px;
}
.mat-mdc-list-option-with-trailing-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before {
  display: inline-block;
  width: 0;
  height: 32px;
  content: "";
  vertical-align: 0;
}
.mat-mdc-list-option-with-trailing-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: -20px;
}
.mat-mdc-list-option-with-trailing-avatar .mdc-list-item__end {
  border-radius: 50%;
}

.mat-mdc-list-option .mdc-checkbox {
  display: inline-block;
  position: relative;
  flex: 0 0 18px;
  box-sizing: content-box;
  width: 18px;
  height: 18px;
  line-height: 0;
  white-space: nowrap;
  cursor: pointer;
  vertical-align: bottom;
  padding: calc((var(--mat-checkbox-state-layer-size, 40px) - 18px) / 2);
  margin: calc((var(--mat-checkbox-state-layer-size, 40px) - var(--mat-checkbox-state-layer-size, 40px)) / 2);
}
.mat-mdc-list-option .mdc-checkbox .mdc-checkbox__native-control {
  position: absolute;
  margin: 0;
  padding: 0;
  opacity: 0;
  cursor: inherit;
  z-index: 1;
  width: var(--mat-checkbox-state-layer-size, 40px);
  height: var(--mat-checkbox-state-layer-size, 40px);
  top: calc((var(--mat-checkbox-state-layer-size, 40px) - var(--mat-checkbox-state-layer-size, 40px)) / 2);
  right: calc((var(--mat-checkbox-state-layer-size, 40px) - var(--mat-checkbox-state-layer-size, 40px)) / 2);
  left: calc((var(--mat-checkbox-state-layer-size, 40px) - var(--mat-checkbox-state-layer-size, 40px)) / 2);
}
.mat-mdc-list-option .mdc-checkbox--disabled {
  cursor: default;
  pointer-events: none;
}
.mat-mdc-list-option .mdc-checkbox__background {
  display: inline-flex;
  position: absolute;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 2px solid currentColor;
  border-radius: 2px;
  background-color: transparent;
  pointer-events: none;
  will-change: background-color, border-color;
  transition: background-color 90ms cubic-bezier(0.4, 0, 0.6, 1), border-color 90ms cubic-bezier(0.4, 0, 0.6, 1);
  -webkit-print-color-adjust: exact;
  color-adjust: exact;
  border-color: var(--mat-checkbox-unselected-icon-color, var(--mat-sys-on-surface-variant));
  top: calc((var(--mat-checkbox-state-layer-size, 40px) - 18px) / 2);
  left: calc((var(--mat-checkbox-state-layer-size, 40px) - 18px) / 2);
}
.mat-mdc-list-option .mdc-checkbox__native-control:enabled:checked ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox__native-control:enabled:indeterminate ~ .mdc-checkbox__background {
  border-color: var(--mat-checkbox-selected-icon-color, var(--mat-sys-primary));
  background-color: var(--mat-checkbox-selected-icon-color, var(--mat-sys-primary));
}
.mat-mdc-list-option .mdc-checkbox--disabled .mdc-checkbox__background {
  border-color: var(--mat-checkbox-disabled-unselected-icon-color, color-mix(in srgb, var(--mat-sys-on-surface) 38%, transparent));
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox--disabled .mdc-checkbox__background {
    border-color: GrayText;
  }
}
.mat-mdc-list-option .mdc-checkbox__native-control:disabled:checked ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox__native-control:disabled:indeterminate ~ .mdc-checkbox__background {
  background-color: var(--mat-checkbox-disabled-selected-icon-color, color-mix(in srgb, var(--mat-sys-on-surface) 38%, transparent));
  border-color: transparent;
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox__native-control:disabled:checked ~ .mdc-checkbox__background,
  .mat-mdc-list-option .mdc-checkbox__native-control:disabled:indeterminate ~ .mdc-checkbox__background {
    border-color: GrayText;
  }
}
.mat-mdc-list-option .mdc-checkbox:hover > .mdc-checkbox__native-control:not(:checked) ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox:hover > .mdc-checkbox__native-control:not(:indeterminate) ~ .mdc-checkbox__background {
  border-color: var(--mat-checkbox-unselected-hover-icon-color, var(--mat-sys-on-surface));
  background-color: transparent;
}
.mat-mdc-list-option .mdc-checkbox:hover > .mdc-checkbox__native-control:checked ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox:hover > .mdc-checkbox__native-control:indeterminate ~ .mdc-checkbox__background {
  border-color: var(--mat-checkbox-selected-hover-icon-color, var(--mat-sys-primary));
  background-color: var(--mat-checkbox-selected-hover-icon-color, var(--mat-sys-primary));
}
.mat-mdc-list-option .mdc-checkbox__native-control:focus:focus:not(:checked) ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox__native-control:focus:focus:not(:indeterminate) ~ .mdc-checkbox__background {
  border-color: var(--mat-checkbox-unselected-focus-icon-color, var(--mat-sys-on-surface));
}
.mat-mdc-list-option .mdc-checkbox__native-control:focus:focus:checked ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox__native-control:focus:focus:indeterminate ~ .mdc-checkbox__background {
  border-color: var(--mat-checkbox-selected-focus-icon-color, var(--mat-sys-primary));
  background-color: var(--mat-checkbox-selected-focus-icon-color, var(--mat-sys-primary));
}
.mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox:hover > .mdc-checkbox__native-control ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox .mdc-checkbox__native-control:focus ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__background {
  border-color: var(--mat-checkbox-disabled-unselected-icon-color, color-mix(in srgb, var(--mat-sys-on-surface) 38%, transparent));
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox:hover > .mdc-checkbox__native-control ~ .mdc-checkbox__background,
  .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox .mdc-checkbox__native-control:focus ~ .mdc-checkbox__background,
  .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__background {
    border-color: GrayText;
  }
}
.mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__native-control:checked ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__native-control:indeterminate ~ .mdc-checkbox__background {
  background-color: var(--mat-checkbox-disabled-selected-icon-color, color-mix(in srgb, var(--mat-sys-on-surface) 38%, transparent));
  border-color: transparent;
}
.mat-mdc-list-option .mdc-checkbox__checkmark {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  opacity: 0;
  transition: opacity 180ms cubic-bezier(0.4, 0, 0.6, 1);
  color: var(--mat-checkbox-selected-checkmark-color, var(--mat-sys-on-primary));
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox__checkmark {
    color: CanvasText;
  }
}
.mat-mdc-list-option .mdc-checkbox--disabled .mdc-checkbox__checkmark, .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__checkmark {
  color: var(--mat-checkbox-disabled-selected-checkmark-color, var(--mat-sys-surface));
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox--disabled .mdc-checkbox__checkmark, .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__checkmark {
    color: GrayText;
  }
}
.mat-mdc-list-option .mdc-checkbox__checkmark-path {
  transition: stroke-dashoffset 180ms cubic-bezier(0.4, 0, 0.6, 1);
  stroke: currentColor;
  stroke-width: 3.12px;
  stroke-dashoffset: 29.7833385;
  stroke-dasharray: 29.7833385;
}
.mat-mdc-list-option .mdc-checkbox__mixedmark {
  width: 100%;
  height: 0;
  transform: scaleX(0) rotate(0deg);
  border-width: 1px;
  border-style: solid;
  opacity: 0;
  transition: opacity 90ms cubic-bezier(0.4, 0, 0.6, 1), transform 90ms cubic-bezier(0.4, 0, 0.6, 1);
  border-color: var(--mat-checkbox-selected-checkmark-color, var(--mat-sys-on-primary));
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox__mixedmark {
    margin: 0 1px;
  }
}
.mat-mdc-list-option .mdc-checkbox--disabled .mdc-checkbox__mixedmark, .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__mixedmark {
  border-color: var(--mat-checkbox-disabled-selected-checkmark-color, var(--mat-sys-surface));
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-checkbox--disabled .mdc-checkbox__mixedmark, .mat-mdc-list-option .mdc-checkbox--disabled.mat-mdc-checkbox-disabled-interactive .mdc-checkbox__mixedmark {
    border-color: GrayText;
  }
}
.mat-mdc-list-option .mdc-checkbox--anim-unchecked-checked .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox--anim-unchecked-indeterminate .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox--anim-checked-unchecked .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox--anim-indeterminate-unchecked .mdc-checkbox__background {
  animation-duration: 180ms;
  animation-timing-function: linear;
}
.mat-mdc-list-option .mdc-checkbox--anim-unchecked-checked .mdc-checkbox__checkmark-path {
  animation: mdc-checkbox-unchecked-checked-checkmark-path 180ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-unchecked-indeterminate .mdc-checkbox__mixedmark {
  animation: mdc-checkbox-unchecked-indeterminate-mixedmark 90ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-checked-unchecked .mdc-checkbox__checkmark-path {
  animation: mdc-checkbox-checked-unchecked-checkmark-path 90ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-checked-indeterminate .mdc-checkbox__checkmark {
  animation: mdc-checkbox-checked-indeterminate-checkmark 90ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-checked-indeterminate .mdc-checkbox__mixedmark {
  animation: mdc-checkbox-checked-indeterminate-mixedmark 90ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-indeterminate-checked .mdc-checkbox__checkmark {
  animation: mdc-checkbox-indeterminate-checked-checkmark 500ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-indeterminate-checked .mdc-checkbox__mixedmark {
  animation: mdc-checkbox-indeterminate-checked-mixedmark 500ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox--anim-indeterminate-unchecked .mdc-checkbox__mixedmark {
  animation: mdc-checkbox-indeterminate-unchecked-mixedmark 300ms linear;
  transition: none;
}
.mat-mdc-list-option .mdc-checkbox__native-control:checked ~ .mdc-checkbox__background,
.mat-mdc-list-option .mdc-checkbox__native-control:indeterminate ~ .mdc-checkbox__background {
  transition: border-color 90ms cubic-bezier(0, 0, 0.2, 1), background-color 90ms cubic-bezier(0, 0, 0.2, 1);
}
.mat-mdc-list-option .mdc-checkbox__native-control:checked ~ .mdc-checkbox__background > .mdc-checkbox__checkmark > .mdc-checkbox__checkmark-path,
.mat-mdc-list-option .mdc-checkbox__native-control:indeterminate ~ .mdc-checkbox__background > .mdc-checkbox__checkmark > .mdc-checkbox__checkmark-path {
  stroke-dashoffset: 0;
}
.mat-mdc-list-option .mdc-checkbox__native-control:checked ~ .mdc-checkbox__background > .mdc-checkbox__checkmark {
  transition: opacity 180ms cubic-bezier(0, 0, 0.2, 1), transform 180ms cubic-bezier(0, 0, 0.2, 1);
  opacity: 1;
}
.mat-mdc-list-option .mdc-checkbox__native-control:checked ~ .mdc-checkbox__background > .mdc-checkbox__mixedmark {
  transform: scaleX(1) rotate(-45deg);
}
.mat-mdc-list-option .mdc-checkbox__native-control:indeterminate ~ .mdc-checkbox__background > .mdc-checkbox__checkmark {
  transform: rotate(45deg);
  opacity: 0;
  transition: opacity 90ms cubic-bezier(0.4, 0, 0.6, 1), transform 90ms cubic-bezier(0.4, 0, 0.6, 1);
}
.mat-mdc-list-option .mdc-checkbox__native-control:indeterminate ~ .mdc-checkbox__background > .mdc-checkbox__mixedmark {
  transform: scaleX(1) rotate(0deg);
  opacity: 1;
}
@keyframes mdc-checkbox-unchecked-checked-checkmark-path {
  0%, 50% {
    stroke-dashoffset: 29.7833385;
  }
  50% {
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
  100% {
    stroke-dashoffset: 0;
  }
}
@keyframes mdc-checkbox-unchecked-indeterminate-mixedmark {
  0%, 68.2% {
    transform: scaleX(0);
  }
  68.2% {
    animation-timing-function: cubic-bezier(0, 0, 0, 1);
  }
  100% {
    transform: scaleX(1);
  }
}
@keyframes mdc-checkbox-checked-unchecked-checkmark-path {
  from {
    animation-timing-function: cubic-bezier(0.4, 0, 1, 1);
    opacity: 1;
    stroke-dashoffset: 0;
  }
  to {
    opacity: 0;
    stroke-dashoffset: -29.7833385;
  }
}
@keyframes mdc-checkbox-checked-indeterminate-checkmark {
  from {
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    transform: rotate(0deg);
    opacity: 1;
  }
  to {
    transform: rotate(45deg);
    opacity: 0;
  }
}
@keyframes mdc-checkbox-indeterminate-checked-checkmark {
  from {
    animation-timing-function: cubic-bezier(0.14, 0, 0, 1);
    transform: rotate(45deg);
    opacity: 0;
  }
  to {
    transform: rotate(360deg);
    opacity: 1;
  }
}
@keyframes mdc-checkbox-checked-indeterminate-mixedmark {
  from {
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
    transform: rotate(-45deg);
    opacity: 0;
  }
  to {
    transform: rotate(0deg);
    opacity: 1;
  }
}
@keyframes mdc-checkbox-indeterminate-checked-mixedmark {
  from {
    animation-timing-function: cubic-bezier(0.14, 0, 0, 1);
    transform: rotate(0deg);
    opacity: 1;
  }
  to {
    transform: rotate(315deg);
    opacity: 0;
  }
}
@keyframes mdc-checkbox-indeterminate-unchecked-mixedmark {
  0% {
    animation-timing-function: linear;
    transform: scaleX(1);
    opacity: 1;
  }
  32.8%, 100% {
    transform: scaleX(0);
    opacity: 0;
  }
}
.mat-mdc-list-option .mdc-radio {
  display: inline-block;
  position: relative;
  flex: 0 0 auto;
  box-sizing: content-box;
  width: 20px;
  height: 20px;
  cursor: pointer;
  will-change: opacity, transform, border-color, color;
  padding: calc((var(--mat-radio-state-layer-size, 40px) - 20px) / 2);
}
.mat-mdc-list-option .mdc-radio__background {
  display: inline-block;
  position: relative;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
}
.mat-mdc-list-option .mdc-radio__background::before {
  position: absolute;
  transform: scale(0, 0);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  content: "";
  transition: opacity 90ms cubic-bezier(0.4, 0, 0.6, 1), transform 90ms cubic-bezier(0.4, 0, 0.6, 1);
  width: var(--mat-radio-state-layer-size, 40px);
  height: var(--mat-radio-state-layer-size, 40px);
  top: calc(-1 * (var(--mat-radio-state-layer-size, 40px) - 20px) / 2);
  left: calc(-1 * (var(--mat-radio-state-layer-size, 40px) - 20px) / 2);
}
.mat-mdc-list-option .mdc-radio__outer-circle {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-width: 2px;
  border-style: solid;
  border-radius: 50%;
  transition: border-color 90ms cubic-bezier(0.4, 0, 0.6, 1);
}
.mat-mdc-list-option .mdc-radio__inner-circle {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  transform: scale(0);
  border-radius: 50%;
  transition: transform 90ms cubic-bezier(0.4, 0, 0.6, 1), background-color 90ms cubic-bezier(0.4, 0, 0.6, 1);
}
@media (forced-colors: active) {
  .mat-mdc-list-option .mdc-radio__inner-circle {
    background-color: CanvasText !important;
  }
}
.mat-mdc-list-option .mdc-radio__native-control {
  position: absolute;
  margin: 0;
  padding: 0;
  opacity: 0;
  top: 0;
  right: 0;
  left: 0;
  cursor: inherit;
  z-index: 1;
  width: var(--mat-radio-state-layer-size, 40px);
  height: var(--mat-radio-state-layer-size, 40px);
}
.mat-mdc-list-option .mdc-radio__native-control:checked + .mdc-radio__background, .mat-mdc-list-option .mdc-radio__native-control:disabled + .mdc-radio__background {
  transition: opacity 90ms cubic-bezier(0, 0, 0.2, 1), transform 90ms cubic-bezier(0, 0, 0.2, 1);
}
.mat-mdc-list-option .mdc-radio__native-control:checked + .mdc-radio__background > .mdc-radio__outer-circle, .mat-mdc-list-option .mdc-radio__native-control:disabled + .mdc-radio__background > .mdc-radio__outer-circle {
  transition: border-color 90ms cubic-bezier(0, 0, 0.2, 1);
}
.mat-mdc-list-option .mdc-radio__native-control:checked + .mdc-radio__background > .mdc-radio__inner-circle, .mat-mdc-list-option .mdc-radio__native-control:disabled + .mdc-radio__background > .mdc-radio__inner-circle {
  transition: transform 90ms cubic-bezier(0, 0, 0.2, 1), background-color 90ms cubic-bezier(0, 0, 0.2, 1);
}
.mat-mdc-list-option .mdc-radio__native-control:disabled:not(:checked) + .mdc-radio__background > .mdc-radio__outer-circle {
  border-color: var(--mat-radio-disabled-unselected-icon-color, var(--mat-sys-on-surface));
  opacity: var(--mat-radio-disabled-unselected-icon-opacity, 0.38);
}
.mat-mdc-list-option .mdc-radio__native-control:disabled + .mdc-radio__background {
  cursor: default;
}
.mat-mdc-list-option .mdc-radio__native-control:disabled + .mdc-radio__background > .mdc-radio__outer-circle {
  border-color: var(--mat-radio-disabled-selected-icon-color, var(--mat-sys-on-surface));
  opacity: var(--mat-radio-disabled-selected-icon-opacity, 0.38);
}
.mat-mdc-list-option .mdc-radio__native-control:disabled + .mdc-radio__background > .mdc-radio__inner-circle {
  background-color: var(--mat-radio-disabled-selected-icon-color, var(--mat-sys-on-surface, currentColor));
  opacity: var(--mat-radio-disabled-selected-icon-opacity, 0.38);
}
.mat-mdc-list-option .mdc-radio__native-control:enabled:not(:checked) + .mdc-radio__background > .mdc-radio__outer-circle {
  border-color: var(--mat-radio-unselected-icon-color, var(--mat-sys-on-surface-variant));
}
.mat-mdc-list-option .mdc-radio__native-control:enabled:checked + .mdc-radio__background > .mdc-radio__outer-circle {
  border-color: var(--mat-radio-selected-icon-color, var(--mat-sys-primary));
}
.mat-mdc-list-option .mdc-radio__native-control:enabled:checked + .mdc-radio__background > .mdc-radio__inner-circle {
  background-color: var(--mat-radio-selected-icon-color, var(--mat-sys-primary, currentColor));
}
.mat-mdc-list-option .mdc-radio__native-control:checked + .mdc-radio__background > .mdc-radio__inner-circle {
  transform: scale(0.5);
  transition: transform 90ms cubic-bezier(0, 0, 0.2, 1), background-color 90ms cubic-bezier(0, 0, 0.2, 1);
}
.mat-mdc-list-option._mat-animation-noopable .mdc-radio__background::before,
.mat-mdc-list-option._mat-animation-noopable .mdc-radio__outer-circle,
.mat-mdc-list-option._mat-animation-noopable .mdc-radio__inner-circle {
  transition: none !important;
}
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mat-mdc-checkbox-touch-target,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mdc-checkbox__native-control,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mdc-checkbox__ripple,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mat-mdc-checkbox-ripple::before,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mdc-checkbox__background,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mdc-checkbox__background > .mdc-checkbox__checkmark,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mdc-checkbox__background > .mdc-checkbox__checkmark > .mdc-checkbox__checkmark-path,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__start > .mdc-checkbox > .mdc-checkbox__background > .mdc-checkbox__mixedmark, .mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mat-mdc-checkbox-touch-target,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mdc-checkbox__native-control,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mdc-checkbox__ripple,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mat-mdc-checkbox-ripple::before,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mdc-checkbox__background,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mdc-checkbox__background > .mdc-checkbox__checkmark,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mdc-checkbox__background > .mdc-checkbox__checkmark > .mdc-checkbox__checkmark-path,
.mat-mdc-list-option._mat-animation-noopable > .mdc-list-item__end > .mdc-checkbox > .mdc-checkbox__background > .mdc-checkbox__mixedmark {
  transition: none !important;
  animation: none !important;
}
.mat-mdc-list-option .mdc-checkbox__native-control, .mat-mdc-list-option .mdc-radio__native-control {
  display: none;
}

@media (forced-colors: active) {
  .mat-mdc-list-option.mdc-list-item--selected::after {
    content: "";
    position: absolute;
    top: 50%;
    right: 16px;
    transform: translateY(-50%);
    width: 10px;
    height: 0;
    border-bottom: solid 10px;
    border-radius: 10px;
  }
  .mat-mdc-list-option.mdc-list-item--selected [dir=rtl]::after {
    right: auto;
    left: 16px;
  }
}
`],encapsulation:2,changeDetection:0})}return i})();var le={provide:_i,useExisting:St(()=>bt),multi:!0},pt=class{source;options;constructor(o,t){this.source=o,this.options=t}},bt=(()=>{class i extends _t{_element=_(L);_ngZone=_(ct);_renderer=_(Rt);_initialized=!1;_keyManager;_listenerCleanups;_destroyed=new yt;_isDestroyed=!1;_onChange=t=>{};_items;selectionChange=new A;color="accent";compareWith=(t,e)=>t===e;get multiple(){return this._multiple}set multiple(t){let e=S(t);e!==this._multiple&&(this._multiple=e,this.selectedOptions=new ht(this._multiple,this.selectedOptions.selected))}_multiple=!0;get hideSingleSelectionIndicator(){return this._hideSingleSelectionIndicator}set hideSingleSelectionIndicator(t){this._hideSingleSelectionIndicator=S(t)}_hideSingleSelectionIndicator=this._defaultOptions?.hideSingleSelectionIndicator??!1;selectedOptions=new ht(this._multiple);_value=null;_onTouched=()=>{};_changeDetectorRef=_(dt);constructor(){super(),this._isNonInteractive=!1}ngAfterViewInit(){this._initialized=!0,this._setupRovingTabindex(),this._ngZone.runOutsideAngular(()=>{this._listenerCleanups=[this._renderer.listen(this._element.nativeElement,"focusin",this._handleFocusin),this._renderer.listen(this._element.nativeElement,"focusout",this._handleFocusout)]}),this._value&&this._setOptionsFromValues(this._value),this._watchForSelectionChange()}ngOnChanges(t){let e=t.disabled,n=t.disableRipple,a=t.hideSingleSelectionIndicator;(n&&!n.firstChange||e&&!e.firstChange||a&&!a.firstChange)&&this._markOptionsForCheck()}ngOnDestroy(){this._keyManager?.destroy(),this._listenerCleanups?.forEach(t=>t()),this._destroyed.next(),this._destroyed.complete(),this._isDestroyed=!0}focus(t){this._element.nativeElement.focus(t)}selectAll(){return this._setAllOptionsSelected(!0)}deselectAll(){return this._setAllOptionsSelected(!1)}_reportValueChange(){if(this.options&&!this._isDestroyed){let t=this._getSelectedOptionValues();this._onChange(t),this._value=t}}_emitChangeEvent(t){this.selectionChange.emit(new pt(this,t))}writeValue(t){this._value=t,this.options&&this._setOptionsFromValues(t||[])}setDisabledState(t){this.disabled=t,this._changeDetectorRef.markForCheck(),this._markOptionsForCheck()}get disabled(){return this._selectionListDisabled()}set disabled(t){this._selectionListDisabled.set(S(t)),this._selectionListDisabled()&&this._keyManager?.setActiveItem(-1)}_selectionListDisabled=F(!1);registerOnChange(t){this._onChange=t}registerOnTouched(t){this._onTouched=t}_watchForSelectionChange(){this.selectedOptions.changed.pipe(at(this._destroyed)).subscribe(t=>{for(let e of t.added)e.selected=!0;for(let e of t.removed)e.selected=!1;this._containsFocus()||this._resetActiveOption()})}_setOptionsFromValues(t){this.options.forEach(e=>e._setSelected(!1)),t.forEach(e=>{let n=this.options.find(a=>a.selected?!1:this.compareWith(a.value,e));n&&n._setSelected(!0)})}_getSelectedOptionValues(){return this.options.filter(t=>t.selected).map(t=>t.value)}_markOptionsForCheck(){this.options&&this.options.forEach(t=>t._markForCheck())}_setAllOptionsSelected(t,e){let n=[];return this.options.forEach(a=>{(!e||!a.disabled)&&a._setSelected(t)&&n.push(a)}),n.length&&this._reportValueChange(),n}get options(){return this._items}_handleKeydown(t){let e=this._keyManager.activeItem;if((t.keyCode===13||t.keyCode===32)&&!this._keyManager.isTyping()&&e&&!e.disabled)t.preventDefault(),e._toggleOnInteraction();else if(t.keyCode===65&&this.multiple&&!this._keyManager.isTyping()&&Zt(t,"ctrlKey","metaKey")){let n=this.options.some(a=>!a.disabled&&!a.selected);t.preventDefault(),this._emitChangeEvent(this._setAllOptionsSelected(n,!0))}else this._keyManager.onKeydown(t)}_handleFocusout=()=>{setTimeout(()=>{this._containsFocus()||this._resetActiveOption()})};_handleFocusin=t=>{if(this.disabled)return;let e=this._items.toArray().findIndex(n=>n._elementRef.nativeElement.contains(t.target));e>-1?this._setActiveOption(e):this._resetActiveOption()};_setupRovingTabindex(){this._keyManager=new Yt(this._items).withHomeAndEnd().withTypeAhead().withWrap().skipPredicate(()=>this.disabled),this._resetActiveOption(),this._keyManager.change.subscribe(t=>this._setActiveOption(t)),this._items.changes.pipe(at(this._destroyed)).subscribe(()=>{let t=this._keyManager.activeItem;(!t||this._items.toArray().indexOf(t)===-1)&&this._resetActiveOption()})}_setActiveOption(t){this._items.forEach((e,n)=>e._setTabindex(n===t?0:-1)),this._keyManager.updateActiveItem(t)}_resetActiveOption(){if(this.disabled){this._setActiveOption(-1);return}let t=this._items.find(e=>e.selected&&!e.disabled)||this._items.first;this._setActiveOption(t?this._items.toArray().indexOf(t):-1)}_containsFocus(){let t=Qt();return t&&this._element.nativeElement.contains(t)}static \u0275fac=function(e){return new(e||i)};static \u0275cmp=N({type:i,selectors:[["mat-selection-list"]],contentQueries:function(e,n,a){if(e&1&&Y(a,ut,5),e&2){let r;D(r=R())&&(n._items=r)}},hostAttrs:["role","listbox",1,"mat-mdc-selection-list","mat-mdc-list-base","mdc-list"],hostVars:1,hostBindings:function(e,n){e&1&&x("keydown",function(r){return n._handleKeydown(r)}),e&2&&v("aria-multiselectable",n.multiple)},inputs:{color:"color",compareWith:"compareWith",multiple:"multiple",hideSingleSelectionIndicator:"hideSingleSelectionIndicator",disabled:"disabled"},outputs:{selectionChange:"selectionChange"},exportAs:["matSelectionList"],features:[rt([le,{provide:_t,useExisting:i},{provide:Ti,useExisting:i}]),$,Bt],ngContentSelectors:Ri,decls:1,vars:0,template:function(e,n){e&1&&(st(),B(0))},styles:[zi],encapsulation:2,changeDetection:0})}return i})(),Pi=(()=>{class i{static \u0275fac=function(e){return new(e||i)};static \u0275mod=K({type:i});static \u0275inj=Q({imports:[Xt,ei,ni,tt,wi]})}return i})();var Ii=(()=>{class i{constructor(){this.elementRef=_(L),this.afterViewInit=new A}ngAfterViewInit(){this.afterViewInit.emit(this.elementRef)}static{this.\u0275fac=function(e){return new(e||i)}}static{this.\u0275dir=C({type:i,selectors:[["","esLifecycle",""]],outputs:{afterViewInit:"afterViewInit"}})}}return i})();var et=class{constructor(){this._inFlightFetchChildNodesRequests={},this._state=new H("initializing")}setFetchChildNodes(o){this._fetchChildNodes=o,this._initTreeRootNodes()}getRootNodes(){return this._state.pipe(Tt(o=>o==="ready"),E(()=>this._rootNodes??[]))}getChildren(o){if(!o)return U([]);if(!this._nodesMap)throw Error("Called `getChildren` without calling `setFetchChildNodes` first.");if(this._nodesMap[o.id]!==o)throw Error("Called getChildren for a node that is not part of the tree.");return o.children?U(o.children):this._fetchChildNodesToTree(o)}_initTreeRootNodes(){this._rootNodes=[],this._nodesMap={},this._inFlightFetchChildNodesRequests={},this._state.next("initializing"),this._fetchChildNodes(null).subscribe({next:o=>{let t=o.map(e=>ot(nt({},e),{level:0})).sort(this._sortNodes);this._rootNodes=t,this._addToNodesMap(t),this._state.next("ready")},error:o=>{this._state.error(o)}})}_fetchChildNodesToTree(o){return this._inFlightFetchChildNodesRequests[o.id]||(this._inFlightFetchChildNodesRequests[o.id]=this._fetchChildNodes(o.id).pipe(E(t=>t.map(e=>ot(nt({},e),{level:o.level+1})).sort(this._sortNodes)),Lt(t=>{o.children=t,this._addToNodesMap(t),delete this._inFlightFetchChildNodesRequests[o.id]}),Pt(1))),this._inFlightFetchChildNodesRequests[o.id]}_sortNodes(o,t){return o.data.title.localeCompare(t.data.title)}_addToNodesMap(o){for(let t of o)this._nodesMap[t.id]=t,t.children&&this._addToNodesMap(t.children)}};function re(){return wt(E(i=>({state:"success",data:i})),Ot(i=>U({state:"error",error:i})),It({state:"loading"}))}var Li=(()=>{class i{transform(t){return t.pipe(re())}static{this.\u0275fac=function(e){return new(e||i)}}static{this.\u0275pipe=zt({name:"wrapObservable",type:i,pure:!0})}}return i})();var Ei=i=>({node:i}),ft=(i,o)=>o.id;function me(i,o){if(i&1&&(s(0,"a",14),g(1,"nodeTitle"),x("click",function(e){return e.stopPropagation()}),y(2),g(3,"nodeTitle"),m()),i&2){let t=c().$implicit,e=c(6);p("href",e.customUrl(t.data),lt)("target",e.customUrlTarget),v("data-text",u(1,4,t.data)),l(2),M(" ",u(3,6,t.data)," ")}}function de(i,o){i&1&&q(0)}function he(i,o){if(i&1&&f(0,de,1,0,"ng-container",15),i&2){let t=c().$implicit;c(6);let e=k(3);p("ngTemplateOutlet",e)("ngTemplateOutletContext",mt(2,Ei,t.data))}}function _e(i,o){if(i&1&&(s(0,"span",16),g(1,"translate"),y(2),m()),i&2){let t=c(2).$implicit,e=c(6);p("matTooltip",u(1,2,e.i18nPrefix+"REFERENCES_LABEL")+": "+t.data.collection.childReferencesCount),l(2),M(" ",t.data.collection.childReferencesCount," ")}}function pe(i,o){i&1&&b(0,"i",17)}function ge(i,o){if(i&1&&(s(0,"div",13),d(1,_e,3,4,"span",16),d(2,pe,1,0,"i",17),m()),i&2){let t=c().$implicit;l(),h(t.data.collection.childReferencesCount?1:-1),l(),h(t.data.collection.childCollectionsCount?2:-1)}}function ue(i,o){if(i&1){let t=V();s(0,"mat-list-option",10),x("click",function(){let n=P(t).$implicit,a=c(6);return a.scrollLeft(),I(a.onSelectedChange(n))})("keydown",function(n){let a=P(t).$implicit,r=c(6);return I(r.onFirstLevelKeydown(n,a))}),s(1,"span",11),d(2,me,4,8,"a",12)(3,he,1,4,"ng-container"),d(4,ge,3,2,"div",13),m()()}if(i&2){let t=o.$implicit,e=c(6);p("value",t)("selected",e.path[0]===t),v("data-node-id",t.id),l(2),h(e.customUrl&&e.customUrl(t.data)?2:3),l(2),h(t.data.collection.childReferencesCount||t.data.collection.childCollectionsCount?4:-1)}}function be(i,o){if(i&1&&X(0,ue,5,5,"mat-list-option",9,ft),i&2){let t=c(2);Z(t.data)}}function fe(i,o){if(i&1&&q(0,8),i&2){c(4);let t=k(6);p("ngTemplateOutlet",t)}}function xe(i,o){if(i&1&&d(0,be,2,0)(1,fe,1,1,"ng-container",8),i&2){let t=c();h((t.data==null?null:t.data.length)>0?0:1)}}function ve(i,o){i&1&&(s(0,"div",6),b(1,"mat-spinner",18),m())}function ke(i,o){if(i&1&&(s(0,"div",7)(1,"p"),y(2),g(3,"translate"),m()()),i&2){let t=c(4);l(2),M(" ",u(3,1,t.i18nPrefix+"ERROR_RECEIVING_DATA")," ")}}function Ce(i,o){if(i&1&&(d(0,xe,2,1),d(1,ve,2,0,"div",6),d(2,ke,4,3,"div",7)),i&2){let t=o;h(t.state==="success"?0:-1),l(),h(t.state==="loading"?1:-1),l(),h(t.state==="error"?2:-1)}}function we(i,o){if(i&1&&(s(0,"mat-selection-list",4),d(1,Ce,3,3),g(2,"wrapObservable"),g(3,"async"),m()),i&2){let t,e=c(2);p("multiple",!1)("hideSingleSelectionIndicator",!0),l(),h((t=u(3,5,u(2,3,e.dataSource.getRootNodes())))?1:-1,t)}}function ye(i,o){i&1&&(s(0,"es-info-message",19),y(1),g(2,"translate"),m()),i&2&&(l(),M(" ",u(2,1,"TOPIC_PAGE.WIDGET.NO_SUBCOLLECTIONS")," "))}function Me(i,o){if(i&1){let t=V();s(0,"div",21)(1,"button",23),x("click",function(){P(t);let n=c(5);return I(n.goBackOneLevel())})("keydown",function(n){P(t);let a=c(5);return I(a.onBackButtonKeydown(n))}),b(2,"i",24),y(3),g(4,"translate"),m()()}i&2&&(l(3),M(" ",u(4,1,"BACK")," "))}function Oe(i,o){if(i&1&&(s(0,"a",14),g(1,"nodeTitle"),x("click",function(e){return e.stopPropagation()}),y(2),g(3,"nodeTitle"),m()),i&2){let t=c().$implicit,e=c(6);p("href",e.customUrl(t.data),lt)("target",e.customUrlTarget),v("data-text",u(1,4,t.data)),l(2),M(" ",u(3,6,t.data)," ")}}function Te(i,o){i&1&&q(0)}function Pe(i,o){if(i&1&&f(0,Te,1,0,"ng-container",15),i&2){let t=c().$implicit;c(6);let e=k(3);p("ngTemplateOutlet",e)("ngTemplateOutletContext",mt(2,Ei,t.data))}}function Ie(i,o){if(i&1&&(s(0,"span",16),g(1,"translate"),y(2),m()),i&2){let t=c(2).$implicit,e=c(6);p("matTooltip",u(1,2,e.i18nPrefix+"REFERENCES_LABEL")+": "+t.data.collection.childReferencesCount),l(2),M(" ",t.data.collection.childReferencesCount," ")}}function Le(i,o){i&1&&b(0,"i",17)}function Se(i,o){if(i&1&&(s(0,"div",13),d(1,Ie,3,4,"span",16),d(2,Le,1,0,"i",17),m()),i&2){let t=c().$implicit;l(),h(t.data.collection.childReferencesCount?1:-1),l(),h(t.data.collection.childCollectionsCount?2:-1)}}function Ee(i,o){if(i&1){let t=V();s(0,"li",27),x("click",function(){let n=P(t).$implicit,a=c(6);return I(n.data.collection.childCollectionsCount&&a.onSelectedChange(n))})("keydown",function(n){let a=P(t).$implicit,r=c(4).$index,O=c(2);return I(O.onChildItemKeydown(n,a,r+1))}),d(1,Oe,4,8,"a",12)(2,Pe,1,4,"ng-container"),d(3,Se,3,2,"div",13),m()}if(i&2){let t=o.$implicit,e=o.$index,n=c(6);w("cursor-pointer",t.data.collection.childCollectionsCount)("item-selected",n.path.includes(t)&&(t.children==null?null:t.children.length)),v("tabindex",e===0?0:-1)("aria-selected",n.path.includes(t))("data-node-id",t.id),l(),h(n.customUrl&&n.customUrl(t.data)?1:2),l(2),h(t.data.collection.childReferencesCount||t.data.collection.childCollectionsCount?3:-1)}}function Ae(i,o){if(i&1){let t=V();s(0,"ul",25),x("afterViewInit",function(n){P(t);let a=c(3).$index,r=c(2);return I(a>0&&r.scrollIntoView(n.nativeElement))}),X(1,Ee,4,9,"li",26,ft),m()}if(i&2){let t=c(2);l(),Z(t.data)}}function Fe(i,o){i&1&&(s(0,"div",6),b(1,"mat-spinner",18),m())}function Be(i,o){if(i&1&&(s(0,"div",7)(1,"p"),y(2),g(3,"translate"),m()()),i&2){let t=c(5);l(2),M(" ",u(3,1,t.i18nPrefix+"ERROR_RECEIVING_DATA")," ")}}function De(i,o){if(i&1&&(s(0,"div"),q(1,8),m()),i&2){c(4);let t=k(6);l(),p("ngTemplateOutlet",t)}}function Re(i,o){if(i&1&&(s(0,"div",20),d(1,Me,5,3,"div",21),g(2,"async"),d(3,Ae,3,0,"ul",22),d(4,Fe,2,0,"div",6),d(5,Be,4,3,"div",7),d(6,De,2,1,"div"),m()),i&2){let t=c(),e=c().$implicit,n=c(2);v("data-parent-id",e.id),l(),h(u(2,6,n.isMobile())?1:-1),l(2),h(t.state==="success"&&t.data.length>0?3:-1),l(),h(t.state==="loading"?4:-1),l(),h(t.state==="error"?5:-1),l(),h(t.state==="success"&&t.data.length===0?6:-1)}}function ze(i,o){if(i&1&&(d(0,Re,7,8,"div",20),g(1,"async")),i&2){let t=c(),e=t.$index,n=t.$count,a=c(2);h(u(1,1,a.isMobile())===!1||e===n-1?0:-1)}}function Ne(i,o){if(i&1&&(d(0,ze,2,3),g(1,"wrapObservable"),g(2,"async")),i&2){let t,e=o.$implicit,n=c(2);h((t=u(2,3,u(1,1,n.dataSource.getChildren(e))))?0:-1,t)}}function Ve(i,o){if(i&1){let t=V();s(0,"es-widget-configuration-buttons",28),x("optionOneClicked",function(){P(t);let n=c(2);return I(n.embedWidget())}),m()}if(i&2){let t=c(2);p("optionOne",t.embedConfigurationOption)("pageVariantNode",t.pageVariantNode)("swimlaneIndex",t.swimlaneIndex)("updateInProgress",t.updateInProgress())}}function je(i,o){if(i&1&&(s(0,"div",2)(1,"div",3),g(2,"async"),d(3,we,4,7,"mat-selection-list",4),g(4,"async"),f(5,ye,3,3,"ng-template",null,1,z),X(7,Ne,3,5,null,null,ft),m(),d(9,Ve,1,4,"es-widget-configuration-buttons",5),m()),i&2){let t=c();l(),w("mobile",u(2,4,t.isMobile())),l(2),h(t.path.length===0||u(4,6,t.isMobile())===!1?3:-1),l(4),Z(t.path),l(2),h(t.editMode()?9:-1)}}function Ue(i,o){i&1&&b(0,"es-spinner")}function $e(i,o){if(i&1&&(s(0,"es-node-url",29),y(1),g(2,"nodeTitle"),m()),i&2){let t=o.node;p("node",t)("mode","link"),l(),M(" ",u(2,3,t)," ")}}var Si=":scope > .child-list-item",mo=(()=>{class i{onResize(){this.width$.next(window.innerWidth)}constructor(){this.elementRef=_(L),this.topicPageGlobalService=_(fi),this.topicPageHelperService=_(vi),this.i18nPrefix="TOPIC_PAGE.WIDGET.TOPICS_COLUMN_BROWSER.",this.MOBILE_WIDTH=860,this.editMode=jt(!1),this.gridIndex=-1,this.sidebarEmbedding=!1,this.swimlaneIndex=-1,this.embedWidgetClicked=new A,this.configChanged=new A,this.customUrlTarget="_self",this.dataSource=new et,this.initialized=F(!1),this.path=[],this.updateInProgress=F(!1),this.width$=new H(window.innerWidth),this.scrollIntoView=Ci,this.topicPageGlobalService.getCustomUrlFunction()&&(this.customUrl=this.topicPageGlobalService.getCustomUrlFunction()),this.customUrlTarget=this.topicPageGlobalService.getCustomUrlTarget()}isMobile(){return this.width$.pipe(E(t=>t<this.MOBILE_WIDTH))}onSelectedChange(t){t&&(this.path=[...this.path.slice(0,t.level),t])}scrollLeft(){this.elementRef.nativeElement.scroll({left:0,behavior:"smooth"})}embedWidget(){this.embedWidgetClicked.emit()}preLoadAction(){return kt(this,null,function*(){this.path=[],this.dataSource.setFetchChildNodes(t=>this.topicPageHelperService.getSubcollections(t??this.contextNodeId,!0).pipe(E(e=>e.collections.filter(n=>!n.properties?.[gi.CCM_PROP_IO_EDITORIAL_STATE]?.includes("deactivated")).map(n=>({id:xi(n),data:n})))))})}onFirstLevelKeydown(t,e){let n=!!e.data.collection.childCollectionsCount,a=t.currentTarget;switch(t.key){case"Enter":{t.preventDefault(),t.stopPropagation(),this.triggerLink(a);break}case" ":case"ArrowRight":{n&&(t.preventDefault(),t.stopPropagation(),this.onSelectedChange(e),this.focusAfterDrilldown(e));break}}}onChildItemKeydown(t,e,n){let a=!!e.data.collection.childCollectionsCount,r=t.currentTarget;switch(t.key){case"Enter":{t.preventDefault(),t.stopPropagation(),this.triggerLink(r);break}case" ":case"ArrowRight":{a&&(t.preventDefault(),t.stopPropagation(),this.onSelectedChange(e),this.focusAfterDrilldown(e));break}case"ArrowLeft":{if(t.preventDefault(),this.getCurrentMobileState()){let O=this.path[this.path.length-1];this.path=this.path.slice(0,this.path.length-1),setTimeout(()=>this.focusNodeAfterMobileBack(O))}else n>1?this.focusChildColumnItem(n-1,this.path[n-2]):this.focusFirstLevelItem(this.path[0]);break}case"ArrowDown":{t.preventDefault(),this.moveChildFocus(r,1);break}case"ArrowUp":{t.preventDefault(),this.moveChildFocus(r,-1);break}case"Home":{t.preventDefault(),this.moveChildFocusToEdge(r,"first");break}case"End":{t.preventDefault(),this.moveChildFocusToEdge(r,"last");break}}}triggerLink(t){t.querySelector("a.item-link, es-node-url a")?.click()}moveChildFocus(t,e){let n=this.getChildSiblings(t);if(n.length===0)return;let a=n.indexOf(t),r=Math.max(0,Math.min(n.length-1,a+e));this.setRovingFocus(n,r)}moveChildFocusToEdge(t,e){let n=this.getChildSiblings(t);n.length!==0&&this.setRovingFocus(n,e==="first"?0:n.length-1)}focusChildColumnItem(t,e){let r=this.elementRef.nativeElement.querySelectorAll(".children-list-container")[t-1]?.querySelector(".child-level-list"),O=r?Array.from(r.querySelectorAll(Si)):[];if(O.length===0)return;let j=this.resolveTargetIndex(O,e);this.setRovingFocus(O,j)}focusFirstLevelItem(t){let e=this.elementRef.nativeElement,n=Array.from(e.querySelectorAll(".first-level-list mat-list-option"));if(n.length===0)return;let a=this.resolveTargetIndex(n,t);n[a]?.focus()}resolveTargetIndex(t,e){if(typeof e=="number")return Math.max(0,Math.min(t.length-1,e));let n=t.findIndex(a=>a.getAttribute("data-node-id")===e?.id);return n>=0?n:0}focusNodeAfterMobileBack(t){t&&(this.path.length===0?this.focusFirstLevelItem(t):this.focusChildColumnItem(this.path.length,t))}focusAfterDrilldown(t){this.waitForColumnReady(t).then(e=>{if(!e)return;let n=Array.from(e.querySelectorAll(".child-level-list > .child-list-item"));if(n.length>0){this.setRovingFocus(n,0);return}this.getCurrentMobileState()&&e.querySelector(".back-button")?.focus()})}waitForColumnReady(t,e=5e3){return new Promise(n=>{let a=this.elementRef.nativeElement,r=()=>a.querySelector(`.children-list-container[data-parent-id="${CSS.escape(t.id)}"]`),O=T=>T?!!(T.querySelector(".child-level-list > .child-list-item")||T.querySelector(":scope > .error-notice")||T.querySelector(".info-message")):!1,j=null,xt=T=>{j?.disconnect(),clearTimeout(Ai),n(T)},vt=()=>{let T=r();return O(T)?(xt(T),!0):!1};j=new MutationObserver(()=>{vt()}),j.observe(a,{childList:!0,subtree:!0});let Ai=setTimeout(()=>{xt(r())},e);vt()})}getChildSiblings(t){let e=t.parentElement;return e?Array.from(e.querySelectorAll(Si)):[]}setRovingFocus(t,e){t.forEach((n,a)=>n.setAttribute("tabindex",a===e?"0":"-1")),t[e]?.focus()}getCurrentMobileState(){return this.width$.value<this.MOBILE_WIDTH}goBackOneLevel(){if(this.path.length===0)return;let t=this.path[this.path.length-1];this.path=this.path.slice(0,this.path.length-1),setTimeout(()=>this.focusNodeAfterMobileBack(t))}onBackButtonKeydown(t){switch(t.key){case"ArrowDown":case"ArrowRight":{t.preventDefault();let e=this.path[this.path.length-1];e&&this.focusAfterDrilldown(e);break}case"ArrowLeft":{t.preventDefault(),this.goBackOneLevel();break}}}static{this.\u0275fac=function(e){return new(e||i)}}static{this.\u0275cmp=N({type:i,selectors:[["es-topics-column-browser"]],hostVars:2,hostBindings:function(e,n){e&1&&x("resize",function(){return n.onResize()},Dt),e&2&&Vt("height",n.height)},inputs:{contextNodeId:"contextNodeId",editMode:[1,"editMode"],embedConfigurationOption:"embedConfigurationOption",gridIndex:"gridIndex",height:"height",pageVariantNode:"pageVariantNode",sidebarEmbedding:"sidebarEmbedding",swimlaneIndex:"swimlaneIndex"},outputs:{embedWidgetClicked:"embedWidgetClicked",configChanged:"configChanged"},decls:4,vars:1,consts:[["nodeLink",""],["noListItems",""],[1,"topics-column-browser"],[1,"node-list"],[1,"first-level-list",3,"multiple","hideSingleSelectionIndicator"],[3,"optionOne","pageVariantNode","swimlaneIndex","updateInProgress"],[1,"spinner-container"],[1,"error-notice"],[3,"ngTemplateOutlet"],[3,"value","selected"],[3,"click","keydown","value","selected"],["matListItemTitle","",1,"list-item-title-container"],["tabindex","-1",1,"item-link","cursor-pointer",3,"href","target"],[1,"container-right"],["tabindex","-1",1,"item-link","cursor-pointer",3,"click","href","target"],[4,"ngTemplateOutlet","ngTemplateOutletContext"],["tooltipAriaLabel","",1,"badge",3,"matTooltip"],["esIcon","keyboard_arrow_right",1,"arrow-right"],["diameter","40"],["mode","info",1,"info-message"],["esLifecycle","",1,"children-list-container"],[1,"back"],["role","listbox","esLifecycle","",1,"child-level-list"],["mat-button","",1,"back-button",3,"click","keydown"],["esIcon","arrow_back_ios"],["role","listbox","esLifecycle","",1,"child-level-list",3,"afterViewInit"],["role","option",1,"child-list-item",3,"cursor-pointer","item-selected"],["role","option",1,"child-list-item",3,"click","keydown"],[3,"optionOneClicked","optionOne","pageVariantNode","swimlaneIndex","updateInProgress"],[3,"node","mode"]],template:function(e,n){e&1&&(d(0,je,10,8,"div",2)(1,Ue,1,0,"es-spinner"),f(2,$e,3,5,"ng-template",null,0,z)),e&2&&h(n.initialized()?0:1)},dependencies:[hi,oi,di,ri,mi,pi,J,li,Ii,Pi,bt,ut,gt,ui,ci,ai,bi,ki,si,Ut,$t,Li],styles:["[_nghost-%COMP%]   .mat-icon[_ngcontent-%COMP%], [_nghost-%COMP%]   .mat-mdc-icon[_ngcontent-%COMP%]{font-size:1.125rem;height:1.125rem;width:1.125rem}[_nghost-%COMP%]   button[_ngcontent-%COMP%]   .mat-icon[_ngcontent-%COMP%], [_nghost-%COMP%]   button[_ngcontent-%COMP%]   .mat-mdc-icon[_ngcontent-%COMP%]{vertical-align:sub}[_nghost-%COMP%]{--mat-list-list-item-focus-state-layer-opacity: 0;--mat-list-list-item-hover-state-layer-opacity: 0;--column-browser-hover-color: var(--backgroundColor);--column-browser-focused-color: var(--listItemSelectedBackground);--column-browser-badge-hover-color: var(--backgroundDim);--column-browser-badge-focused-color: var(--primaryBackground100)}.topics-column-browser[_ngcontent-%COMP%]   .node-list[_ngcontent-%COMP%]{margin-top:8px;margin-bottom:8px;display:inline-flex;overflow-x:auto;overflow-y:hidden;flex-grow:1;background:var(--color-readable-overlay)}.topics-column-browser[_ngcontent-%COMP%]   .node-list.mobile[_ngcontent-%COMP%]{display:flex}.cursor-pointer[_ngcontent-%COMP%]{cursor:pointer}.spinner-container[_ngcontent-%COMP%]{height:100%;display:grid;flex-grow:1}.spinner-container[_ngcontent-%COMP%]   mat-spinner[_ngcontent-%COMP%]{margin:auto}.error-notice[_ngcontent-%COMP%]{padding:10px 20px}.error-notice[_ngcontent-%COMP%]{border:1px solid #b71c1c;background-color:#ffcdd2}.error-notice[_ngcontent-%COMP%]   p[_ngcontent-%COMP%]{margin:0}.item-link[_ngcontent-%COMP%], es-node-url[_ngcontent-%COMP%]    >a{text-decoration:unset;color:var(--textMain);display:inline-block}.item-link[_ngcontent-%COMP%]:before, es-node-url[_ngcontent-%COMP%]    >a:before{content:attr(data-text);font-weight:700;visibility:hidden;display:block;height:0;overflow:hidden}.item-link[_ngcontent-%COMP%]:hover, es-node-url[_ngcontent-%COMP%]    >a:hover{font-weight:700!important}.item-link[_ngcontent-%COMP%]:focus-visible, es-node-url[_ngcontent-%COMP%]    >a:focus-visible{border:3px solid var(--primary, #003b7c);border-radius:6px;outline:none}.first-level-list[_ngcontent-%COMP%], .children-list-container[_ngcontent-%COMP%]{min-width:325px;flex-shrink:0}.first-level-list[_ngcontent-%COMP%]   .container-right[_ngcontent-%COMP%], .children-list-container[_ngcontent-%COMP%]   .container-right[_ngcontent-%COMP%]{margin-left:75px;display:inline-flex;align-items:center;gap:16px}.first-level-list[_ngcontent-%COMP%]   .container-right[_ngcontent-%COMP%]   .badge[_ngcontent-%COMP%], .children-list-container[_ngcontent-%COMP%]   .container-right[_ngcontent-%COMP%]   .badge[_ngcontent-%COMP%]{padding:0 5px;font:600 11px Montserrat;line-height:140%;text-align:center;vertical-align:middle;border-radius:12px;color:var(--textMain);background:var(--backgroundColor)}.first-level-list[_ngcontent-%COMP%]{padding:0;overflow-y:auto;box-shadow:0 4px 4px #0006}.first-level-list[_ngcontent-%COMP%]  mat-list-option:focus .mat-mdc-focus-indicator:before{border-radius:0}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]{padding:0 20px}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]   .list-item-title-container[_ngcontent-%COMP%]{display:flex;justify-content:space-between;align-items:center}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]   .list-item-title-container[_ngcontent-%COMP%]   .item-link[_ngcontent-%COMP%]{overflow:hidden;text-overflow:ellipsis}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]   .list-item-title-container[_ngcontent-%COMP%]   .mat-icon[_ngcontent-%COMP%]{flex-shrink:0}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]:hover{background:var(--column-browser-hover-color)}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]:hover   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-hover-color)!important}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]:active{background:var(--column-browser-focused-color)}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]:active   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-focused-color)!important}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]:focus-visible{border:3px solid var(--primary, #003b7c);border-radius:2px;background:var(--column-browser-focused-color)}.first-level-list[_ngcontent-%COMP%]   mat-list-option[_ngcontent-%COMP%]:focus-visible   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-focused-color)!important}.first-level-list[_ngcontent-%COMP%]   mat-list-option.mdc-list-item--selected[_ngcontent-%COMP%]{border:none;border-left:6px solid var(--primary, #003b7c)!important;background:var(--column-browser-focused-color)!important}.first-level-list[_ngcontent-%COMP%]   mat-list-option.mdc-list-item--selected[_ngcontent-%COMP%]   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-focused-color)!important}.children-list-container[_ngcontent-%COMP%]{display:flex;flex-direction:column}.children-list-container[_ngcontent-%COMP%]:last-of-type   .child-level-list[_ngcontent-%COMP%]{flex-wrap:wrap}.children-list-container[_ngcontent-%COMP%]:not(:last-of-type){overflow-y:auto;overflow-x:hidden;flex-direction:column;box-shadow:0 4px 4px #0006}.children-list-container[_ngcontent-%COMP%]   .back[_ngcontent-%COMP%]{padding:5px 15px}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]{margin:0;padding:0;flex-shrink:0;display:flex;flex-direction:column}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]{padding:0 20px;height:var(--mat-list-list-item-one-line-container-height);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;background-color:unset;border:unset;text-align:unset}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]:hover{background:var(--column-browser-hover-color)}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]:hover   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-hover-color)!important}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]:active{background:var(--column-browser-focused-color)}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]:active   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-focused-color)!important}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item.item-selected[_ngcontent-%COMP%]{margin-left:0;border:none;border-left:6px solid var(--primary, #003b7c)!important;background:var(--column-browser-focused-color)!important}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item.item-selected[_ngcontent-%COMP%]   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-focused-color)!important}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]:focus-visible{outline:none;border:3px solid var(--primary, #003b7c)!important;border-radius:2px;background:var(--column-browser-focused-color)!important}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]:focus-visible   .badge[_ngcontent-%COMP%]{background:var(--column-browser-badge-focused-color)!important}.children-list-container[_ngcontent-%COMP%]   .child-level-list[_ngcontent-%COMP%]   .child-list-item[_ngcontent-%COMP%]   .item-link[_ngcontent-%COMP%]{font-family:var(--mat-list-list-item-label-text-font);line-height:var(--mat-list-list-item-label-text-line-height);font-size:var(--mat-list-list-item-label-text-size);font-weight:var(--mat-list-list-item-label-text-weight);letter-spacing:var(--mat-list-list-item-label-text-tracking)}.children-list-container[_ngcontent-%COMP%]   .info-message[_ngcontent-%COMP%]{margin-left:8px;display:block}@media screen and (max-width:860px){.first-level-list[_ngcontent-%COMP%], .children-list-container[_ngcontent-%COMP%], .child-list-item[_ngcontent-%COMP%]{min-width:unset;width:100%;box-sizing:border-box;overflow:hidden}}[_nghost-%COMP%]     mat-selection-list mat-list-option .mdc-button__label{display:flex;align-items:center}"]})}}return i})();export{mo as TopicsColumnBrowserComponent};
