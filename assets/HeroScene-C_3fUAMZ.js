import{a,j as e}from"./motion-CLPSl4-9.js";import{u as B,M as q,a as T,W as H,P as J,b as K,c as N,C as Q,S as W,_ as Y,d as ee,F as te,e as re,R as ae}from"./FrameCap-DaEQQCji.js";const ne={uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`
      varying vec2 vUv;

      void main() {

        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

      }
  `,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float h;

    varying vec2 vUv;

    void main() {

    	vec4 sum = vec4( 0.0 );

    	sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;

    	gl_FragColor = sum;

    }
  `},se={uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`
    varying vec2 vUv;

    void main() {

      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

    }
  `,fragmentShader:`

  uniform sampler2D tDiffuse;
  uniform float v;

  varying vec2 vUv;

  void main() {

    vec4 sum = vec4( 0.0 );

    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;

    gl_FragColor = sum;

  }
  `},I=a.forwardRef(({children:t,enabled:s=!0,speed:r=1,rotationIntensity:n=1,floatIntensity:u=1,floatingRange:l=[-.1,.1],autoInvalidate:S=!1,...b},c)=>{const o=a.useRef(null);a.useImperativeHandle(c,()=>o.current,[]);const D=a.useRef(Math.random()*1e4);return B(U=>{var p,g;if(!s||r===0)return;S&&U.invalidate();const m=D.current+U.clock.elapsedTime;o.current.rotation.x=Math.cos(m/4*r)/8*n,o.current.rotation.y=Math.sin(m/4*r)/8*n,o.current.rotation.z=Math.sin(m/4*r)/20*n;let v=Math.sin(m/4*r)/10;v=q.mapLinear(v,-.1,.1,(p=l?.[0])!==null&&p!==void 0?p:-.1,(g=l?.[1])!==null&&g!==void 0?g:.1),o.current.position.y=v*u,o.current.updateMatrix()}),a.createElement("group",b,a.createElement("group",{ref:o,matrixAutoUpdate:!1},t))}),oe=a.forwardRef(({scale:t=10,frames:s=1/0,opacity:r=1,width:n=1,height:u=1,blur:l=1,near:S=0,far:b=10,resolution:c=512,smooth:o=!0,color:D="#000000",depthWrite:U=!1,renderOrder:p,...g},m)=>{const v=a.useRef(null),f=T(i=>i.scene),d=T(i=>i.gl),y=a.useRef(null);n=n*(Array.isArray(t)?t[0]:t||1),u=u*(Array.isArray(t)?t[1]:t||1);const[M,O,$,x,w,C,P]=a.useMemo(()=>{const i=new H(c,c),k=new H(c,c);k.texture.generateMipmaps=i.texture.generateMipmaps=!1;const F=new J(n,u).rotateX(Math.PI/2),X=new K(F),j=new N;j.depthTest=j.depthWrite=!1,j.onBeforeCompile=h=>{h.uniforms={...h.uniforms,ucolor:{value:new Q(D)}},h.fragmentShader=h.fragmentShader.replace("void main() {",`uniform vec3 ucolor;
           void main() {
          `),h.fragmentShader=h.fragmentShader.replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );","vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );")};const z=new W(ne),A=new W(se);return A.depthTest=z.depthTest=!1,[i,F,j,X,z,A,k]},[c,n,u,t,D]),E=i=>{x.visible=!0,x.material=w,w.uniforms.tDiffuse.value=M.texture,w.uniforms.h.value=i*1/256,d.setRenderTarget(P),d.render(x,y.current),x.material=C,C.uniforms.tDiffuse.value=P.texture,C.uniforms.v.value=i*1/256,d.setRenderTarget(M),d.render(x,y.current),x.visible=!1};let G=0,L,_;return B(()=>{y.current&&(s===1/0||G<s)&&(G++,L=f.background,_=f.overrideMaterial,v.current.visible=!1,f.background=null,f.overrideMaterial=$,d.setRenderTarget(M),d.render(f,y.current),E(l),o&&E(l*.4),d.setRenderTarget(null),v.current.visible=!0,f.overrideMaterial=_,f.background=L)}),a.useImperativeHandle(m,()=>v.current,[]),a.createElement("group",Y({"rotation-x":Math.PI/2},g,{ref:v}),a.createElement("mesh",{renderOrder:p,geometry:O,scale:[1,-1,1],rotation:[-Math.PI/2,0,0]},a.createElement("meshBasicMaterial",{transparent:!0,map:M.texture,opacity:r,depthWrite:U})),a.createElement("orthographicCamera",{ref:y,args:[-n/2,n/2,u/2,-u/2,S,b]}))});function V({position:t}){return e.jsx(I,{speed:2,rotationIntensity:1.2,floatIntensity:1.4,children:e.jsxs("mesh",{position:t,rotation:[Math.PI/2,0,0],castShadow:!0,children:[e.jsx("cylinderGeometry",{args:[.34,.34,.09,32]}),e.jsx("meshStandardMaterial",{color:"#facc15",metalness:.3,roughness:.35})]})})}function Z({position:t}){return e.jsx(I,{speed:1.6,rotationIntensity:.8,floatIntensity:1.2,children:e.jsxs("group",{position:t,rotation:[.2,.4,.1],children:[e.jsx(ae,{args:[.55,.72,.05],radius:.04,castShadow:!0,children:e.jsx("meshStandardMaterial",{color:"#ffffff",roughness:.6})}),[.16,.04,-.08].map((s,r)=>e.jsxs("mesh",{position:[0,s,.03],children:[e.jsx("boxGeometry",{args:[.34,.04,.01]}),e.jsx("meshStandardMaterial",{color:"#86efac"})]},r))]})})}function R({position:t,color:s="#38bdf8"}){return e.jsx(I,{speed:2.4,rotationIntensity:1.5,floatIntensity:1.6,children:e.jsxs("mesh",{position:t,castShadow:!0,children:[e.jsx("icosahedronGeometry",{args:[.26,0]}),e.jsx("meshStandardMaterial",{color:s,roughness:.3,flatShading:!0})]})})}function ie({children:t,enabled:s}){const r=a.useRef(null),{pointer:n}=T();return B(()=>{!r.current||!s||(r.current.rotation.y+=(n.x*.35-r.current.rotation.y)*.05,r.current.rotation.x+=(-n.y*.2-r.current.rotation.x)*.05)}),e.jsx("group",{ref:r,children:t})}function le({animate:t=!0,onContextLost:s}){return e.jsxs(ee,{shadows:!0,frameloop:"demand",dpr:[1,1.5],gl:{antialias:!0,alpha:!0},camera:{position:[0,.5,6],fov:42},style:{width:"100%",height:"100%"},onCreated:({gl:r})=>{r.domElement.addEventListener("webglcontextlost",n=>{n.preventDefault(),s?.()},{once:!0})},children:[e.jsx(te,{fps:30}),e.jsx("hemisphereLight",{args:["#ffffff","#d7f5e3",.9]}),e.jsx("ambientLight",{intensity:.45}),e.jsx("directionalLight",{position:[4,6,5],intensity:1.6,castShadow:!0,"shadow-mapSize":[1024,1024],"shadow-bias":-4e-4}),e.jsx("directionalLight",{position:[-5,2,-3],intensity:.5,color:"#bae6fd"}),e.jsx("pointLight",{position:[0,3,2],intensity:.55,color:"#fde68a"}),e.jsxs(a.Suspense,{fallback:null,children:[e.jsxs(ie,{enabled:t,children:[e.jsx(re,{animate:t}),e.jsx(V,{position:[2.1,.6,.4]}),e.jsx(V,{position:[-2.3,-.2,.2]}),e.jsx(Z,{position:[-2,1.2,-.3]}),e.jsx(Z,{position:[2.4,-.8,-.2]}),e.jsx(R,{position:[1.5,1.6,.6],color:"#38bdf8"}),e.jsx(R,{position:[-1.4,1.5,.3],color:"#facc15"}),e.jsx(R,{position:[0,-1.9,.8],color:"#fb7185"})]}),e.jsx(oe,{position:[0,-2.05,0],opacity:.28,scale:9,blur:2.6,far:3.5,color:"#16a34a",frames:1})]})]})}export{le as default};
