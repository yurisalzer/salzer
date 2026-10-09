"""Inspecao nao destrutiva de DBF e XLSX; somente stdlib Python 3.11+."""
import argparse, json, struct, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

def dbf_info(path):
    with open(path,'rb') as f:
        header=f.read(32)
        count=struct.unpack('<I',header[4:8])[0]
        header_size=struct.unpack('<H',header[8:10])[0]
        row_size=struct.unpack('<H',header[10:12])[0]
        fields=[]
        while f.tell()<header_size:
            b=f.read(32)
            if not b or b[0]==13:break
            if b[0]==0:break
            fields.append({'nome':b[:11].split(b'\0')[0].decode('ascii','replace'),'tipo':chr(b[11]),'tamanho':b[16],'decimais':b[17]})
        return {'arquivo':path.name,'registros':count,'tamanho_registro':row_size,'campos':fields}

def xlsx_info(path):
    ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(path) as z:
        root=ET.fromstring(z.read('xl/workbook.xml'))
        sheets=[s.attrib['name'] for s in root.findall('.//m:sheet',ns)]
    return {'arquivo':path.name,'abas':sheets}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('diretorio',type=Path)
    args=ap.parse_args();result=[]
    for p in sorted(args.diretorio.rglob('*')):
        if p.suffix.lower()=='.dbf':result.append(dbf_info(p))
        elif p.suffix.lower()=='.xlsx':result.append(xlsx_info(p))
    print(json.dumps(result,ensure_ascii=False,indent=2))
