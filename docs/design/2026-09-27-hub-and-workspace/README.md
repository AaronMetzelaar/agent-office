# Hub and workspace design boards

These are the chosen boards from the design canvas: https://claude.ai/artifact/VriJh789MbBDismRPxar73

They're artboard sources for the canvas's Design type. They use its `support.js` and `{{holes}}`, so open them on the canvas to see them rendered. Here they're for reading markup, colours and geometry.

| Board | What it shows | Requirements |
|---|---|---|
| `Z5-Hub.dc.html` | The hub: the network on the left, the triage column on the right | R4–R9 |
| `Z3-Auto.dc.html` | Suggested work and lines started for you | R26–R32 |
| `U1-Switcher.dc.html` | The workspace with the title-bar switcher open | R10–R13, R17 |
| `U2-CtrlTab.dc.html` | The ⌃Tab overlay | R17 |
| `U3-Resting.dc.html` | The workspace at rest: squeezed line, open stop, right column | R10–R13 |
| `V1-Incoming.dc.html` | Connector items arriving | R26–R29 |
| `V2-Connected.dc.html` | "Connected to this line" in the workspace | R13, R26 |
| `S4-Workbench.dc.html` | The ⌘J workbench | R14 |
| `S5-Branch.dc.html` | A side chat branching and reconnecting | R23–R25 |

`hub.py` generates `Z5-Hub`. Its constants hold the network geometry that Unit 7 of the plan ports: the stage column x positions, the lane spacing and the 45° fan-out.

The rejected rounds are kept on the canvas only: characters, the isometric office, and the early skins.
