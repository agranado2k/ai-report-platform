# Deep Modules

From "A Philosophy of Software Design":

**Deep module** = small interface + lots of implementation

```mermaid
flowchart TB
    accTitle: A deep module
    accDescr: One small interface node sits above a subgraph of five implementation nodes, so the interface is narrow and the implementation behind it is tall.
    i["Interface: two methods, simple parameters"]
    subgraph impl["Implementation, hidden behind the interface"]
        direction TB
        a["parse"] --> b["validate"] --> c["resolve"] --> d["cache"] --> e["report"]
    end
    i --> impl
```

**Shallow module** = large interface + little implementation (avoid)

```mermaid
flowchart TB
    accTitle: A shallow module
    accDescr: Five sibling interface nodes sit above one lone implementation node, so the interface is as wide as the implementation is thin.
    subgraph iface["Interface: many methods, each with its own parameters"]
        direction LR
        m1["get"] ~~~ m2["set"] ~~~ m3["has"] ~~~ m4["list"] ~~~ m5["clear"]
    end
    x["Implementation: a pass-through"]
    iface --> x
```

When designing interfaces, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?
