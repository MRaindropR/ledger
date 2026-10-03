const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const source=process.argv[2];if(!source)throw Error('Pass legacy index.html path');
const html=fs.readFileSync(source,'utf8');
const assets=JSON.parse(html.match(/const SL_ART_V2=([^\n]+);/)[1]);
const icons=Object.fromEntries(Object.entries(assets).map(([id,data])=>[id,Buffer.from(data.split(',')[1],'base64').toString('utf8')]));
if(Object.values(icons).some(s=>!s.startsWith('<svg')))throw Error('Expected official SVG assets');
fs.mkdirSync(path.join(root,'src/generated'),{recursive:true});
fs.writeFileSync(path.join(root,'src/generated/icons.json'),JSON.stringify(icons));
for(const name of ['EXP_CATS','INC_CATS']){const section=html.slice(html.indexOf('const '+name+' = ')+name.length+9);const end=section.indexOf('];');const data=Function('return '+section.slice(0,end+1))();fs.writeFileSync(path.join(root,'src/generated',name+'.json'),JSON.stringify(data));}
