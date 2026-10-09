"""
Gera uma AMOSTRA REDUZIDA de planilhas oficiais do SINAPI para testes automatizados.

As linhas mantidas são copiadas do XML original sem alteração (mesmos números de linha,
fórmulas HYPERLINK, valores e estilos); só as strings compartilhadas são renumeradas.
Uso (somente biblioteca padrão do Python 3.11+):

  python3 -I scripts/fixtures/reduzir_sinapi.py ORIGEM.xlsx DESTINO.xlsx 104658,95995 [--insumos 1,2] [--manutencoes 20]

As composições informadas são incluídas com todo o fechamento analítico (subcomposições
e insumos). O mesmo script serve para o relatório de mão de obra e o de manutenções.
"""
import re, sys, zipfile

LINHA = re.compile(r'<row [^>]*>.*?</row>|<row [^>]*/>', re.S)
CEL = re.compile(r'<c r="([A-Z]+)(\d+)"([^>]*?)(?:/>|>(.*?)</c>)', re.S)
V = re.compile(r'<v>(.*?)</v>', re.S)
F = re.compile(r'<f[^>]*>(.*?)</f>', re.S)
HYPER = re.compile(r',\s*(\d+)\)\s*$')
SI = re.compile(r'<si>.*?</si>|<si/>', re.S)
CABECALHO = 10  # linhas de título/cabeçalho mantidas integralmente (o adaptador as localiza por rótulo)


def celulas(xml_linha):
    for m in CEL.finditer(xml_linha):
        yield m.group(1), m.group(3), m.group(4) or ''


def ler_strings(z):
    try:
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    except KeyError:
        return [], '', ''
    itens = SI.findall(xml)
    ini = xml[:xml.index('<si')]
    fim = xml[xml.rindex('</sst>'):]
    return itens, ini, fim


def texto_si(si):
    return ''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))


def valor(attrs, corpo, strings):
    v = V.search(corpo)
    if not v:
        return None
    if 't="s"' in attrs:
        return texto_si(strings[int(v.group(1))])
    return v.group(1)


def codigo_celula(attrs, corpo, strings):
    f = F.search(corpo)
    if f:
        m = HYPER.search(f.group(1).replace('&amp;', '&'))
        if m:
            return m.group(1)
    return valor(attrs, corpo, strings)


def linhas_aba(xml):
    a, b = xml.index('<sheetData'), xml.index('</sheetData>')
    a = xml.index('>', a) + 1
    return xml[:a], LINHA.findall(xml[a:b]), xml[b:]


def num_linha(row):
    return int(re.search(r'<row r="(\d+)"', row).group(1))


def coluna_de(row, col, strings, codigo=False):
    for c, attrs, corpo in celulas(row):
        if c == col:
            return codigo_celula(attrs, corpo, strings) if codigo else valor(attrs, corpo, strings)
    return None


def main():
    origem, destino, comps = sys.argv[1], sys.argv[2], [c for c in sys.argv[3].split(',') if c]
    extras_ins = set()
    n_man = 20
    if '--insumos' in sys.argv:
        extras_ins = set(sys.argv[sys.argv.index('--insumos') + 1].split(','))
    if '--manutencoes' in sys.argv:
        n_man = int(sys.argv[sys.argv.index('--manutencoes') + 1])

    zin = zipfile.ZipFile(origem)
    strings, sst_ini, sst_fim = ler_strings(zin)
    wb = zin.read('xl/workbook.xml').decode('utf-8')
    rels = zin.read('xl/_rels/workbook.xml.rels').decode('utf-8')
    alvo = {m.group(1): m.group(2) for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels)}
    alvo.update({m.group(2): m.group(1) for m in re.finditer(r'Target="([^"]+)"[^>]*Id="([^"]+)"', rels)})
    abas = {}
    for m in re.finditer(r'<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"', wb):
        abas[m.group(1)] = 'xl/' + alvo[m.group(2)].lstrip('/').replace('xl/', '')

    # Fechamento analítico das composições pedidas
    manter_comp, manter_ins = set(comps), set(extras_ins)
    if 'Analítico' in abas:
        _, rows, _ = linhas_aba(zin.read(abas['Analítico']).decode('utf-8'))
        filhos = {}
        for r in rows:
            if num_linha(r) <= CABECALHO:
                continue
            pai = coluna_de(r, 'B', strings, codigo=True)
            tipo = coluna_de(r, 'C', strings)
            item = coluna_de(r, 'D', strings)
            if tipo:
                filhos.setdefault(pai, []).append((tipo, item))
        pilha = list(comps)
        while pilha:
            c = pilha.pop()
            for tipo, item in filhos.get(c, []):
                if tipo == 'COMPOSICAO' and item not in manter_comp:
                    manter_comp.add(item)
                    pilha.append(item)
                elif tipo == 'INSUMO':
                    manter_ins.add(item)

    usados = set()
    novos_xml = {}
    for nome, caminho in abas.items():
        xml = zin.read(caminho).decode('utf-8')
        ini, rows, fim = linhas_aba(xml)
        sel = []
        n_manut = 0
        for r in rows:
            n = num_linha(r)
            if n <= CABECALHO or nome in ('Menu', 'Busca', 'Analítico com Custo'):
                sel.append(r)
                continue
            if nome in ('ISD', 'ICD', 'ISE', 'Coeficientes'):
                ok = coluna_de(r, 'B', strings) in manter_ins
            elif nome == 'Manutenções':
                n_manut += 1
                ok = n_manut <= n_man
            else:  # CSD/CCD/CSE, Analítico, mão de obra
                ok = coluna_de(r, 'B', strings, codigo=True) in manter_comp
            if ok:
                sel.append(r)
        for r in sel:
            for _c, attrs, corpo in celulas(r):
                if 't="s"' in attrs:
                    v = V.search(corpo)
                    if v:
                        usados.add(int(v.group(1)))
        novos_xml[caminho] = (ini, sel, fim)

    mapa = {old: new for new, old in enumerate(sorted(usados))}

    def remapear(row):
        def troca(m):
            col, n, attrs, corpo = m.group(1), m.group(2), m.group(3), m.group(4)
            if corpo is None:
                return m.group(0)
            if 't="s"' in attrs:
                corpo = V.sub(lambda v: '<v>%d</v>' % mapa[int(v.group(1))], corpo)
            return '<c r="%s%s"%s>%s</c>' % (col, n, attrs, corpo)
        return CEL.sub(troca, row)

    finais = {}
    for caminho, (ini, sel, fim) in novos_xml.items():
        linhas_mantidas = {num_linha(r) for r in sel}
        # Mantém só os hyperlinks (e suas relações) das linhas preservadas
        fim = re.sub(r'<hyperlink [^>]*ref="[A-Z]+(\d+)"[^>]*/>',
                     lambda m: m.group(0) if int(m.group(1)) in linhas_mantidas else '', fim)
        fim = re.sub(r'<hyperlinks>\s*</hyperlinks>', '', fim)
        finais[caminho] = ini + ''.join(remapear(r) for r in sel) + fim

    def rels_de(caminho):
        d, b = caminho.rsplit('/', 1)
        return d + '/_rels/' + b + '.rels'
    rels_filtradas = {}
    for caminho, xml in finais.items():
        try:
            rx = zin.read(rels_de(caminho)).decode('utf-8')
        except KeyError:
            continue
        ids = set(re.findall(r'r:id="([^"]+)"', xml))
        rels_filtradas[rels_de(caminho)] = re.sub(r'<Relationship [^>]*Id="([^"]+)"[^>]*/>',
                                                 lambda m: m.group(0) if m.group(1) in ids else '', rx)

    with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            if info.filename in finais:
                zout.writestr(info.filename, finais[info.filename])
            elif info.filename in rels_filtradas:
                zout.writestr(info.filename, rels_filtradas[info.filename])
            elif info.filename == 'xl/sharedStrings.xml':
                lista = [strings[i] for i in sorted(usados)]
                ini = re.sub(r'count="\d+"', 'count="%d"' % len(lista), sst_ini)
                ini = re.sub(r'uniqueCount="\d+"', 'uniqueCount="%d"' % len(lista), ini)
                zout.writestr(info.filename, ini + ''.join(lista) + sst_fim)
            elif info.filename.startswith('xl/media/') or info.filename.startswith('xl/drawings/'):
                zout.writestr(info.filename, zin.read(info.filename))
            else:
                zout.writestr(info.filename, zin.read(info.filename))
    print('composições:', len(manter_comp), 'insumos:', len(manter_ins), 'strings:', len(usados))


if __name__ == '__main__':
    main()
