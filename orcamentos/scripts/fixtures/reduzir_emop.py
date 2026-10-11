"""
Gera uma AMOSTRA REDUZIDA dos DBF oficiais da EMOP para testes automatizados.

Registros copiados BYTE A BYTE do arquivo oficial (cabeçalho original, contagem ajustada).
Inclui os serviços pedidos com todo o fechamento: componentes (COMP), elementares
(MAT/REUT/ELEM) e as composições vinculadas aos elementares reutilizados.

  python3 -I scripts/fixtures/reduzir_emop.py DIR_ORIGEM DIR_DESTINO MMAA 01.001.0001-0,59.003.0060-B
"""
import struct, sys, os


def ler(caminho):
    dados = open(caminho, 'rb').read()
    n, hs, rs = struct.unpack('<IHH', dados[4:12])
    campos, pos, desl = {}, 32, 1
    while dados[pos] != 0x0D:
        nome = dados[pos:pos + 11].split(b'\0')[0].decode()
        tam = dados[pos + 16]
        campos[nome] = (desl, tam)
        desl += tam
        pos += 32
    regs = [dados[hs + i * rs: hs + (i + 1) * rs] for i in range(n)]
    return dados[:hs], campos, regs


def campo(reg, campos, nome):
    d, t = campos[nome]
    return reg[d:d + t].decode('cp850').strip()


def gravar(caminho, cab, regs):
    cab = bytearray(cab)
    cab[4:8] = struct.pack('<I', len(regs))
    with open(caminho, 'wb') as f:
        f.write(bytes(cab))
        for r in regs:
            f.write(r)
        f.write(b'\x1a')


def main():
    origem, destino, mmaa, servicos = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(',')
    os.makedirs(destino, exist_ok=True)
    arq = {p: ler(os.path.join(origem, '%s%s.dbf' % (p, mmaa))) for p in ('EMOP', 'DIPR', 'COMP', 'MAT', 'REUT', 'ELEM')}
    _, cc, comp = arq['COMP']
    _, cr, reut = arq['REUT']
    vinculo = {campo(r, cr, 'ELEMENTAR'): campo(r, cr, 'COMPOSICAO') for r in reut}
    compacto = {}
    _, cd, dipr = arq['DIPR']
    for r in dipr:
        c = campo(r, cd, 'CODIGO')
        compacto[c.replace('.', '').replace('-', '')] = c
    por_pai = {}
    for r in comp:
        por_pai.setdefault(campo(r, cc, 'CODIGO'), []).append(r)
    manter_serv, manter_elem = set(), set()
    pilha = list(servicos)
    while pilha:
        s = pilha.pop()
        if s in manter_serv:
            continue
        manter_serv.add(s)
        for r in por_pai.get(s, []):
            e = campo(r, cc, 'ELEMENTAR')
            manter_elem.add(e)
            if e in vinculo:
                pilha.append(compacto[vinculo[e]])
    filtros = {
        'EMOP': ('CODIGO', manter_serv), 'DIPR': ('CODIGO', manter_serv), 'COMP': ('CODIGO', manter_serv),
        'MAT': ('ELEMENTAR', manter_elem), 'REUT': ('ELEMENTAR', manter_elem), 'ELEM': ('ELEMENTAR', manter_elem),
    }
    for p, (nome_campo, conjunto) in filtros.items():
        cab, campos, regs = arq[p]
        sel = [r for r in regs if campo(r, campos, nome_campo) in conjunto]
        gravar(os.path.join(destino, '%s%s.dbf' % (p, mmaa)), cab, sel)
        print(p, len(sel))


if __name__ == '__main__':
    main()
