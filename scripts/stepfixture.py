#!/usr/bin/env python3
"""A small STEP (AP214) assembly for the STEP viewer's tests: a bracket (a
20 x 20 x 10 box with a radius 5 hole through it, the hole face red) placed
twice, and a pin (a cylinder with a flat bottom and a hemisphere on top,
orange). It exercises planes with holes, a cylinder with a seam edge, a
cylinder band between two circles, a sphere closed at its pole, colours on
solids and faces, and placed instances.

  python3 scripts/stepfixture.py OUTDIR   ->  OUTDIR/assembly.step
"""
import math
import os
import sys


class Step:
    def __init__(self):
        self.lines = []

    def add(self, text):
        self.lines.append(text)
        return "#%d" % len(self.lines)

    def pt(self, p):
        return self.add("CARTESIAN_POINT('',(%s))" % ",".join("%.6f" % x for x in p))

    def dir(self, d):
        return self.add("DIRECTION('',(%s))" % ",".join("%.6f" % x for x in d))

    def ax(self, o, z=(0, 0, 1), x=(1, 0, 0)):
        return self.add("AXIS2_PLACEMENT_3D('',%s,%s,%s)" % (self.pt(o), self.dir(z), self.dir(x)))

    def text(self, name):
        head = [
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION(('Monoform test assembly'),'2;1');",
            "FILE_NAME('%s','2026-01-01T00:00:00',(''),(''),'stepfixture.py','','');" % name,
            "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
            "ENDSEC;",
            "DATA;",
        ]
        body = ["#%d=%s;" % (i + 1, l) for i, l in enumerate(self.lines)]
        return "\n".join(head + body + ["ENDSEC;", "END-ISO-10303-21;", ""])


def build():
    s = Step()
    app = s.add("APPLICATION_CONTEXT('automotive design')")
    s.add("APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,%s)" % app)
    pctx = s.add("PRODUCT_CONTEXT('',%s,'mechanical')" % app)
    pdctx = s.add("PRODUCT_DEFINITION_CONTEXT('part definition',%s,'design')" % app)
    mm = s.add("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))")
    rad = s.add("(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))")
    sr = s.add("(NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT())")
    unc = s.add("UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),%s,'distance_accuracy_value','')" % mm)
    ctx = s.add("(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((%s)) GLOBAL_UNIT_ASSIGNED_CONTEXT((%s,%s,%s)) REPRESENTATION_CONTEXT('',''))" % (unc, mm, rad, sr))

    def product(pid, name):
        p = s.add("PRODUCT('%s','%s','',(%s))" % (pid, name, pctx))
        f = s.add("PRODUCT_DEFINITION_FORMATION('','',%s)" % p)
        return s.add("PRODUCT_DEFINITION('design','',%s,%s)" % (f, pdctx))

    def part(pid, name, solid):
        pd = product(pid, name)
        pds = s.add("PRODUCT_DEFINITION_SHAPE('','',%s)" % pd)
        origin = s.ax((0, 0, 0))
        sr_ = s.add("SHAPE_REPRESENTATION('%s',(%s),%s)" % (name, origin, ctx))
        s.add("SHAPE_DEFINITION_REPRESENTATION(%s,%s)" % (pds, sr_))
        brep = s.add("ADVANCED_BREP_SHAPE_REPRESENTATION('%s',(%s,%s),%s)" % (name, s.ax((0, 0, 0)), solid, ctx))
        s.add("SHAPE_REPRESENTATION_RELATIONSHIP('','',%s,%s)" % (sr_, brep))
        return pd, sr_, origin

    vertices = {}
    edges = {}

    def vertex(p):
        if p not in vertices:
            vertices[p] = s.add("VERTEX_POINT('',%s)" % s.pt(p))
        return vertices[p]

    def line_edge(a, b):
        """An oriented edge from a to b (the edge curve made once, used both ways)."""
        if (b, a) in edges:
            return s.add("ORIENTED_EDGE('',*,*,%s,.F.)" % edges[(b, a)])
        if (a, b) not in edges:
            d = [y - x for x, y in zip(a, b)]
            l = math.sqrt(sum(x * x for x in d))
            ln = s.add("LINE('',%s,%s)" % (s.pt(a), s.add("VECTOR('',%s,%.6f)" % (s.dir([x / l for x in d]), l))))
            edges[(a, b)] = s.add("EDGE_CURVE('',%s,%s,%s,.T.)" % (vertex(a), vertex(b), ln))
        return s.add("ORIENTED_EDGE('',*,*,%s,.T.)" % edges[(a, b)])

    def circle_edge(centre, r):
        """A full circle (axis +Z) starting and ending at centre + (r, 0, 0)."""
        v = vertex((centre[0] + r, centre[1], centre[2]))
        c = s.add("CIRCLE('',%s,%.6f)" % (s.ax(centre), r))
        return s.add("EDGE_CURVE('',%s,%s,%s,.T.)" % (v, v, c))

    def oe(edge, forward):
        return s.add("ORIENTED_EDGE('',*,*,%s,%s)" % (edge, ".T." if forward else ".F."))

    def loop(oes, outer=True, orient=True):
        l = s.add("EDGE_LOOP('',(%s))" % ",".join(oes))
        return s.add("%s('',%s,%s)" % ("FACE_OUTER_BOUND" if outer else "FACE_BOUND", l, ".T." if orient else ".F."))

    def face(bounds, surf, same=True):
        return s.add("ADVANCED_FACE('',(%s),%s,%s)" % (",".join(bounds), surf, ".T." if same else ".F."))

    def plane(o, z, x=(1, 0, 0)):
        return s.add("PLANE('',%s)" % s.ax(o, z, x))

    def ring(pts):
        return [line_edge(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]

    # ---- bracket: box 20 x 20 x 10, hole r 5 at (10, 10) ----
    W, H, R = 20.0, 10.0, 5.0
    c = lambda x, y, z: (x * W, y * W, z * H)
    bot_c = circle_edge((10.0, 10.0, 0.0), R)
    top_c = circle_edge((10.0, 10.0, H), R)
    seam_ln = s.add("LINE('',%s,%s)" % (s.pt((15.0, 10.0, 0.0)), s.add("VECTOR('',%s,1.)" % s.dir((0, 0, 1)))))
    seam = s.add("EDGE_CURVE('',%s,%s,%s,.T.)" % (vertex((15.0, 10.0, 0.0)), vertex((15.0, 10.0, H)), seam_ln))
    faces = []
    # Bottom (normal -Z, given as a +Z plane with same_sense .F.): outer
    # clockwise seen from above, the hole anticlockwise.
    faces.append(face([loop(ring([c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)])), loop([oe(bot_c, True)], False)], plane((0, 0, 0), (0, 0, 1)), False))
    faces.append(face([loop(ring([c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)])), loop([oe(top_c, False)], False)], plane((0, 0, H), (0, 0, 1))))
    faces.append(face([loop(ring([c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]))], plane((0, 0, 0), (0, -1, 0))))
    faces.append(face([loop(ring([c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]))], plane((W, 0, 0), (1, 0, 0), (0, 1, 0))))
    faces.append(face([loop(ring([c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)]))], plane((0, W, 0), (0, 1, 0))))
    faces.append(face([loop(ring([c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)]))], plane((0, 0, 0), (-1, 0, 0), (0, 1, 0))))
    # The hole: a cylinder whose face looks at its axis; one loop with the seam.
    hole = face([loop([oe(bot_c, False), oe(seam, True), oe(top_c, True), oe(seam, False)])], s.add("CYLINDRICAL_SURFACE('',%s,%.6f)" % (s.ax((10.0, 10.0, 0.0)), R)), False)
    faces.append(hole)
    shell = s.add("CLOSED_SHELL('',(%s))" % ",".join(faces))
    bracket = s.add("MANIFOLD_SOLID_BREP('Bracket',%s)" % shell)

    # ---- pin: r 4, cylinder z 0..20, hemisphere on top ----
    PR, PH = 4.0, 20.0
    pb = circle_edge((0.0, 0.0, 0.0), PR)
    pt_ = circle_edge((0.0, 0.0, PH), PR)
    pin_faces = [
        face([loop([oe(pb, False)])], plane((0, 0, 0), (0, 0, -1))),
        face([loop([oe(pb, True)]), loop([oe(pt_, False)], False)], s.add("CYLINDRICAL_SURFACE('',%s,%.6f)" % (s.ax((0, 0, 0)), PR))),
        face([loop([oe(pt_, True)])], s.add("SPHERICAL_SURFACE('',%s,%.6f)" % (s.ax((0, 0, PH)), PR))),
    ]
    pin = s.add("MANIFOLD_SOLID_BREP('Pin',%s)" % s.add("CLOSED_SHELL('',(%s))" % ",".join(pin_faces)))

    # ---- colours: bracket steel blue, its hole red, the pin orange ----
    def style(item, rgb):
        col = s.add("COLOUR_RGB('',%.4f,%.4f,%.4f)" % rgb)
        fill = s.add("FILL_AREA_STYLE('',(%s))" % s.add("FILL_AREA_STYLE_COLOUR('',%s)" % col))
        side = s.add("SURFACE_SIDE_STYLE('',(%s))" % s.add("SURFACE_STYLE_FILL_AREA(%s)" % fill))
        usage = s.add("SURFACE_STYLE_USAGE(.BOTH.,%s)" % side)
        curve = s.add("CURVE_STYLE('',%s,POSITIVE_LENGTH_MEASURE(0.1),%s)" % (s.add("DRAUGHTING_PRE_DEFINED_CURVE_FONT('continuous')"), s.add("COLOUR_RGB('',0.,0.,0.)")))
        psa = s.add("PRESENTATION_STYLE_ASSIGNMENT((%s,%s))" % (curve, usage))
        return s.add("STYLED_ITEM('color',(%s),%s)" % (psa, item))

    styled = [style(bracket, (0.30, 0.50, 0.80)), style(hole, (0.90, 0.10, 0.10)), style(pin, (1.00, 0.55, 0.00))]
    s.add("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(%s),%s)" % (",".join(styled), ctx))

    # ---- product structure ----
    bpd, bsr, borigin = part("bracket", "Bracket", bracket)
    ppd, psr, porigin = part("pin", "Pin", pin)
    apd = product("assembly", "Assembly")
    apds = s.add("PRODUCT_DEFINITION_SHAPE('','',%s)" % apd)
    places = [
        (bpd, bsr, borigin, s.ax((0, 0, 0))),
        (bpd, bsr, borigin, s.ax((40, 0, 0), (0, 0, 1), (0, 1, 0))),  # turned 90° about Z
        (ppd, psr, porigin, s.ax((10, 10, -5))),  # through the first bracket's hole
    ]
    asr = s.add("SHAPE_REPRESENTATION('Assembly',(%s),%s)" % (",".join([s.ax((0, 0, 0))] + [p[3] for p in places]), ctx))
    s.add("SHAPE_DEFINITION_REPRESENTATION(%s,%s)" % (apds, asr))
    for i, (pd, psr_, origin, at) in enumerate(places):
        nauo = s.add("NEXT_ASSEMBLY_USAGE_OCCURRENCE('%d','i%d','',%s,%s,$)" % (i + 1, i + 1, apd, pd))
        idt = s.add("ITEM_DEFINED_TRANSFORMATION('','',%s,%s)" % (origin, at))
        rel = s.add("(REPRESENTATION_RELATIONSHIP('','',%s,%s) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(%s) SHAPE_REPRESENTATION_RELATIONSHIP())" % (psr_, asr, idt))
        s.add("CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(%s,%s)" % (rel, s.add("PRODUCT_DEFINITION_SHAPE('','',%s)" % nauo)))
    return s.text("assembly.step")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "assembly.step"), "w") as f:
        f.write(build())
