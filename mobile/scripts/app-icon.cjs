const fs=require('fs'),path=require('path');
const sharp=require(process.env.SHARP_PATH||'sharp');
const root=path.resolve(__dirname,'..');
const icons=require('../src/generated/icons.json');
const body=icons.receipt.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#e3efb5"/><g transform="translate(192 192) scale(20)">${body}</g></svg>`;
sharp(Buffer.from(svg)).png().toFile(path.join(root,'assets/icon.png'));
