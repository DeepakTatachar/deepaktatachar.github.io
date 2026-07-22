/*
 *  This is an ARM Cortex-M0 instruction set simulator.
 *
 *  This software is adapted from the original
 *  6502 assembler and simulator in Javascript
 *  (C)2006-2010 Stian Soreng - www.6502asm.com
 *
 *  Adapted by Nick Morgan
 *  https://github.com/skilldrick/6502js
 *
 *  Released under the GNU General Public License
 *  see http://gnu.org/licenses/gpl.html
 */

'use strict';

var activeFileName = "main.s";

function SimulatorWidget(node) {
    var $node = $(node);


    var SP = 13;
    var LR = 14;
    var PC = 15;
    var APSR = 100;

    var TEXT_START = 0x08000300;
    var DATA_START = 0x20000000;

    var ui = UI();
    var display = Display();
    var reg = Registers();
    var memory = Memory();
    var instrs = Instructions();
    var labels = Labels();
    var simulator = Simulator();
    var assembler = Assembler();
    var pc_line_map = new Object();
    var range, rangeStartup;

    function initialize() {
        stripText();
        ui.initialize();
        display.initialize();
        simulator.reset();

        $node.find('.assembleButton').click(onClickAssemble);
        $node.find('.runButton').click(simulator.runBinary);
        $node.find('.runButton').click(simulator.stopDebugger);

        // TODO: Need to see how this can be done better
        $node.find('.resetButton').click(onClickAssemble);
        $node.find('.hexdumpButton').click(assembler.hexdump);
        $node.find('.disassembleButton').click(assembler.disassemble);
        $node.find('.start, .length').blur(simulator.handleMonitorRangeChange);
        $node.find('.stepButton').click(simulator.debugExec);
        $node.find('.gotoButton').click(simulator.gotoAddr);
        $node.find('.notesButton').click(ui.showNotes);

        // Initalize ace editor theme
        var editor = ace.edit("startup-editor");
        editor.setTheme("ace/theme/chrome");
        editor.session.setMode("ace/mode/cortexM0");
        editor.setOptions({ fontSize: "10pt" });

        // Make startup file read only
        editor.commands.on("exec", function(e) { 
           e.preventDefault();
           e.stopPropagation();
        });

        editor = ace.edit("editor");
        editor.setTheme("ace/theme/chrome");
        editor.session.setMode("ace/mode/cortexM0");
        editor.setOptions({ fontSize: "10pt" });

        // Set cursor to the line right after main
        var row = 0;
        var column = 0;

        // Or simply Infinity
        // var column = editor.session.getLine(row).length;
        editor.gotoLine(row, column);

        editor.on("guttermousedown", function(e){ handleBreakPoints(e) });

        editor.keyBinding.addKeyboardHandler(simulator.stop);
        editor.keyBinding.addKeyboardHandler(ui.initialize);
        editor.container.addEventListener("keydown", ui.captureTabInEditor, true);

        editor.on("paste", function(e) {
            simulator.stop();
            ui.initialize();
        });

        $(document).keypress(memory.storeKeypress);

        ui.showNotes();
        ui.toggleMonitor();
        simulator.toggleMonitor();
        simulator.handleMonitorRangeChange();
    }

    function onClickAssemble() {
        simulator.reset();
        var success = assembler.assembleCode("main.s");

        // If successful then highlight the first line to be executed. 
        if(success) {
            simulator.cpu_reset();
            simulator.highlightNextExecution();
        }
    }

    function handleBreakPoints(e) {
        var editor = ace.edit("editor");
        var target = e.domEvent.target; 
        if (target.className.indexOf("ace_gutter-cell") == -1) 
            return; 
        if (!editor.isFocused()) 
            return; 
        if (e.clientX > 25 + target.getBoundingClientRect().left) 
            return; 

        var newBreakpoint = e.getDocumentPosition().row;

        var existingBreakPoints =  e.editor.session.getBreakpoints();

        // Check if breakpoint exists if so clear break point else
        // set breakpoint
        if(newBreakpoint in existingBreakPoints) {
            e.editor.session.clearBreakpoint(newBreakpoint);
        } else {
            e.editor.session.setBreakpoint(newBreakpoint);
        }

        e.stop() 
    }

    function stripText() {
        //Remove leading and trailing space in textarea
        var text = ace.edit("editor").getValue();
        text = text.replace(/^\n+/, '').replace(/\s+$/, '');
        ace.edit("editor").setValue(text);
    }

    function regtoname(reg) {
        if (reg >= 0 && reg < 13)
            return "r" + reg.toString(10);
        if (reg === SP)
            return "sp";
        if (reg === LR)
            return "lr";
        if (reg === PC)
            return "pc";
        if (reg === APSR)
            return "apsr";
        return "r???" + reg.toString(10);
    }

    function regtolist(bits) {
        var str = "{"
        var prev=-100;
        for(var i = 0; i<16; i += 1) {
            if ((bits & (1<<i)) === 0)
                continue;
            if (prev == i-1) {
                if (bits & (1<<(i+1))) {
                    prev = i;
                    continue;
                } else {
                    prev = i;
                    str += "-" + regtoname(i);
                }
            } else if (prev >= 0) {
                prev = i;
                str += "," + regtoname(i);
            } else {
                prev = i;
                str += regtoname(i);
            }
        }
        str += "}";
        return str;
    }

    function openPopup(content, title) {
        var w = window.open('', title, 'width=500,height=300,resizable=yes,scrollbars=yes,toolbar=no,location=no,menubar=no,status=no');

        var html = "<html><head>";
        html += "<link href='style.css' rel='stylesheet' type='text/css' />";
        html += "<title>" + title + "</title></head><body>";
        html += "<pre><code>";

        html += content;

        html += "</code></pre></body></html>";
        w.document.write(html);
        w.document.close();
    }

    function Instructions() {

        function asmmsg(str) {
            message("Error line " + assembler.getline() + ": "
                    + assembler.gettext() + ": " + str);
        }

        function bigreg(r) {
            if (r > 15) {
                asmmsg("Cannot use R" + r.toString(10) + ". Only r0-r15.");
                return false;
            }
            return true;
        }
        function smallreg(r) {
            if (r > 7) {
                asmmsg("Cannot use " + regtoname(r) + ". Only r0-r7.");
                return false;
            }
            return true;
        }
        function immed(val, lo, hi) {
            if (val < lo) {
                asmmsg("Immediate value must not be less than " +
                       lo.toString(10));
                return false;
            }
            if (val > hi) {
                asmmsg("Immediate value must not be greater than " +
                       hi.toString(10));
                return false;
            }
            return true;
        }
        function divisible(val, div) {
            if ((val % div) != 0) {
                asmmsg("Immediate value (" + val.toString(10) +
                       ") not divisible by " + div.toString(10));
                return false;
            }
            return true;
        }

        function AddWithCarry(x, y, cin) {
            var result = x + y + cin;
            result &= 0xffffffff; // Only pay attention to 32 bits.
            var xtop = (x >> 31) & 0x1;
            var ytop = (y >> 31) & 0x1;
            var rtop = (result >> 31) & 0x1;
            var cout = xtop & ytop | ytop & !rtop | !rtop & xtop;
            var ovf = (xtop & ytop & !rtop) | (!xtop & !ytop & rtop);
            return [result, cout, ovf];
        }

        // Add two registers with carry-in
        var ADC2 = {
            length: 2,
            exec: function(inst) {
                var rdn = (inst & 7);
                var rm = (inst >> 3) & 0x7;
                var result;
                var cout;
                var ovf;
                [result,cout,ovf] = AddWithCarry(reg.read(rdn), reg.read(rm),
                                                 reg.getc());
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4140;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= (rdn << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rdn = (inst & 7);
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      adcs    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Add Rdn, #imm
        var ADD1I = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rdn = (inst >> 8) & 7;
                var result,cout,ovf;
                [result,cout,ovf] = AddWithCarry(reg.read(rdn), imm, 0);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rdn,result);
            },
            asm: function(rdn, imm) {
                var op = 0x3000;
                if (rdn === SP)
                    return null;
                if (!smallreg(rdn))
                    return null;
                if (!immed(imm, 0, 255))
                    return null;
                op |= imm;
                op |= (rdn << 8);
                return op;
            },
            dis: function(inst) {
                var imm = inst & 0xff;
                var rdn = (inst >> 8) & 7;
                var str = hex16(inst) + "      adds    " + regtoname(rdn)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Add two registers
        var ADD2 = {
            length: 2,
            exec: function(inst) {
                var rdn = (inst & 7) | ((inst >> (7 - 3)) & 0x8);
                var rm = (inst >> 3) & 0xf;
                var result,cout,ovf;
                [result,cout,ovf] = AddWithCarry(reg.read(rdn), reg.read(rm),0);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4400;
                if (!bigreg(rdn) || !bigreg(rm))
                    return null;
                op |= ((rdn << 0) & 0x7);
                op |= ((rdn & 0x8) << (7-3));
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rdn = (inst & 7) | (  ((inst >> 7) & 0x01) << 3);
                var rm = (inst >> 3) & 0xf;
                var str = hex16(inst) + "      adds    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Add Rd, Rn, #imm
        var ADD2I = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 7;
                var rd = inst & 7;
                var rn = (inst >> 3) & 7;
                var result,cout,ovf;
                [result,cout,ovf] = AddWithCarry(reg.read(rn), imm, 0);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rd,result);
            },
            asm: function(rd, rn, imm) {
                var op = 0x1c00;
                if (rn === SP)
                    return null;
                if (!smallreg(rd) || !smallreg(rn))
                    return null;
                if (rd === rn)
                    return ADD1I.asm(rd, imm);
                if (!immed(imm, 0, 7))
                    return null;
                op |= (imm << 6);
                op |= (rn << 3);
                op |= (rd << 0);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rd = inst & 7;
                var str = hex16(inst) + "      adds    " + regtoname(rd)
                    + ", " + regtoname(rn)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Add three registers
        var ADD3 = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 7;
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var result,cout,ovf;
                [result,cout,ovf] = AddWithCarry(reg.read(rm), reg.read(rn), 0);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rd,result);
            },
            asm: function(rd, rn, rm) {
                var op = 0x1800;
                if (!smallreg(rd) || !smallreg(rm) || !smallreg(rn)) {
                    return null;
                }
                op |= (rd << 0);
                op |= (rm << 6);
                op |= (rn << 3);
                return op;
            },
            dis: function(inst) {
                var rd = (inst >> 0) & 7;
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var str = hex16(inst) + "      adds    " + regtoname(rd)
                    + ", " + regtoname(rn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Adds two registers
        var ADDS2 = {
            length: 2,
            asm: function(rd, rm) {
                return ADD3.asm(rd,rd,rm);
            }
        };

        // ADD SP #imm
        var ADD_SI = {
            length: 2,
            exec: function(inst) {
                var imm = 0x7f & inst;
                reg.write(SP, reg.read(SP) + (4 * imm));
            },
            asm: function(reg, imm) {
                var op = 0xb000;
                if (reg != SP) {
                    asmmsg("Cannot use " + regtoname(reg) + ". Only SP.");
                    return false;
                }
                if (!immed(imm, 0, 508))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (imm >> 2);
                return op;
            },
            dis: function(inst) {
                var imm = (inst & 0x7f) * 4;
                var str = hex16(inst) + "      add     sp, sp, #"
                    + imm.toString(10);
                return str;
            }
        };

        // ADD Reg, SP, #imm
        var ADD_RSI = {
            length: 2,
            exec: function(inst) {
                var rd = (inst >> 8) & 0x7;
                var imm = 0xff & inst;
                reg.write(rd, reg.read(SP) + (4 * imm));
            },
            asm: function(rd, sp, imm) {
                var op = 0xa800;
                if (sp != SP) {
                    asmmsg("Cannot use " + regtoname(sp) + ". Only SP.");
                    return null;
                }
                if (rd == SP)
                    return ADD_SI.asm(sp, imm);
                if (!smallreg(rd))
                    return null;
                if (!immed(imm, 0, 1020))
                    return null;
                op |= (rd << 8);
                op |= (imm >> 2);
                return op;
            },
            dis: function(inst) {
                var rd = (inst >> 8) & 0x7;
                var imm = (inst & 0xff) * 4;
                var str = hex16(inst) + "      adds    " + regtoname(rd)
                    + ", sp, #" + imm.toString(10);
                return str;
            }
        };

        // ADR Reg, #imm (Address to Register: find offset from PC)
        var ADR = {
            length: 2,
            exec: function(inst) {
                var rd = (inst >> 8) & 0x7;
                var imm = 0x7f & inst;
                var pc = reg.read(PC) + 2;
                pc = pc >> 2;
                pc = pc << 2; // pc rounded up to 4-byte boundary
                reg.write(rd, pc + (4 * imm));
            },
            asm: function(regnum, imm) {
                var op = 0xa000;
                if (!smallreg(regnum))
                    return null;
                if (!immed(imm, 0, 1020))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (regnum << 8);
                op |= (imm >> 2);
                return op;
            },
            dis: function(inst) {
                var rd = (inst >> 8) & 0x7;
                var imm = (inst & 0xff) * 4;
                var str = hex16(inst) + "      adr     " + regtoname(rd)
                    + ", pc + #" + imm.toString(10);
                return str;
            }
        };

        // And two registers
        var AND2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rdn) & reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4000;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      ands    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // And 3 registers
        var AND3 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rdn) & reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdn,result);
            },
            asm: function(rd, rn, rm) {
                var op = 0x4000;
                if(rd != rn)
                    return null;
                if (!smallreg(rn) || !smallreg(rm))
                    return null;
                op |= rn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      ands    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Arithmetic shift right Rdn by Rm
        var ASR2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var amount = reg.read(rm);
                if (amount === 0)
                    amount = 32;
                var val = reg.read(rdn);
                var result,cout;

                var sign = (val >> 31) & 1;
                if (amount === 32) {
                    if (sign)
                        result = 0xffffffff;
                    cout = sign;
                } else if (amount > 32) {
                    if (sign) {
                        result = 0xffffffff;
                        cout = 1;
                    }
                } else {
                    result = (val >> (amount-1));
                    cout = result & 1;
                    result = result >> 1;
                }
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4100;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      asrs    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // ASR Rdn, Rm, #imm
        var ASR2I = {
            length: 2,
            exec: function(inst) {
                var amount = (inst >> 6) & 0x1f;
                if (amount === 0)
                    amount = 32;
                var rm = (inst >> 3) & 7;
                var rd = (inst >> 0) & 7;
                var val = reg.read(rm);
                var result,cout;

                var sign = (val >> 31) & 1;
                if (amount === 32) {
                    if (sign)
                        result = 0xffffffff;
                    cout = sign;
                } else {
                    result = (val >> (amount-1));
                    cout = result & 1;
                    result = result >> 1;
                }
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rd, result);
            },
            asm: function(rd, rm, imm) {
                var op = 0x1000;
                if (!smallreg(rd) || !smallreg(rm))
                    return null;
                if (!immed(imm, 1, 32))
                    return null;
                if (imm === 32)
                    imm = 0;
                op |= (imm << 6);
                op |= (rd << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                if (imm === 0)
                    imm = 32;
                var rm = (inst >> 3) & 7;
                var rd = (inst >> 0) & 7;
                var str = hex16(inst) + "      "
                    + "asrs    " + regtoname(rd)
                    + ", " + regtoname(rm)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Branch (always) with an 11-bit relative displacement.
        var B = {
            length: 2,
            exec: function(inst) {
                var imm11 = inst & 0x7ff;
                if (imm11 & 0x400)
                    imm11 |= 0xfffff800; // sign extend
                var disp = imm11 << 1;

                // Account for the Cortex M0 pipeline
                disp = disp + 2;
                var addr = (reg.read(PC) + disp) & 0xffffffff;
                reg.write(PC, addr);
            },
            asm: function(disp) {
                // Account for the Cortex M0 pipeline
                disp = disp - 2;
                var op = 0xe000;
                if (!immed(disp, -2048, 2046))
                    return null;
                if (disp & 0x1) {
                    asmmsg("Displacement must be aligned with a two-byte boundary.");
                    return null;
                }
                var imm8 = (disp >> 1) & 0x7ff;
                op |= imm8;
                return op;
            },
            dis: function(inst) {
                var imm11 = (inst & 0x7ff);
                if (imm11 & 0x400)
                    imm11 |= 0xfffff800; // sign extend
                var disp = imm11 << 1;

                // Account for the Cortex M0 pipeline
                // Checking with values from the actual hardware debugger
                disp = disp + 2;

                var addr = (assembler.getTextPC() + disp) & 0xffffffff;
                var label = labels.findByAddr(addr);
                var str;

                // Account for the Cortex M0 pipeline
                disp = disp + 2;
                if (label === null) {
                    if (disp & 0x80000000) {
                        var negdisp = (disp ^ 0xffffffff) + 1;
                        str = hex16(inst) + "      b       " + "pc - "
                            + negdisp.toString(10) + " ; " + hex32(addr);
                    } else
                        str = hex16(inst) + "      b       " + "pc + "
                        + disp.toString(10) + " ; " + hex32(addr);
                } else
                    str = hex16(inst) + "      b       " + label;
                return str;
            }
        };

        function branch(addr) {
            reg.write(PC, addr);
        }

        function condname(cond) {
            switch(cond) {
            case 0b0000: return "eq";
            case 0b0001: return "ne";
            case 0b0010: return "cs";
            case 0b0011: return "cc";
            case 0b0100: return "mi";
            case 0b0101: return "pl";
            case 0b0110: return "vs";
            case 0b0111: return "vc";
            case 0b1000: return "hi";
            case 0b1001: return "ls";
            case 0b1010: return "ge";
            case 0b1011: return "lt";
            case 0b1100: return "gt";
            case 0b1101: return "le";
            case 0b1110: return "al";
            }
        }

        // Branch on a condition with an 8-bit relative displacement.
        var Bcond = {
            length: 2,
            exec: function(inst) {
                var cond = (inst >> 8) & 0xf;
                var disp = (inst & 0xff) << 1;
                if (disp & 0x100)
                    disp |= 0xfffffe00; // sign-extend
                // Account for the Cortex M0 pipeline
                disp = disp + 2;
                var addr = (reg.read(PC) + disp) & 0xffffffff;
                switch(cond) {
                case 0b0000: if (reg.getz() === 1) branch(addr); break;
                case 0b0001: if (reg.getz() === 0) branch(addr); break;
                case 0b0010: if (reg.getc() === 1) branch(addr); break;
                case 0b0011: if (reg.getc() === 0) branch(addr);break;
                case 0b0100: if (reg.getn() === 1) branch(addr);break;
                case 0b0101: if (reg.getn() === 0) branch(addr);break;
                case 0b0110: if (reg.getv() === 1) branch(addr);break;
                case 0b0111: if (reg.getv() === 0) branch(addr);break;
                case 0b1000: if (reg.getc() === 1 && reg.getz() === 0)       branch(addr);break;
                case 0b1001: if (reg.getc() === 0 || reg.getz() === 1)       branch(addr);break;
                case 0b1010: if (reg.getn() === reg.getv())                  branch(addr);break;
                case 0b1011: if (reg.getn() !== reg.getv())                  branch(addr);break;
                case 0b1100: if (reg.getz()===0 && reg.getn()===reg.getv())  branch(addr);break;
                case 0b1101: if (reg.getz()===1 || reg.getn()!==reg.getv()) branch(addr);break;
                case 0b1110: branch(addr);break;
                //case 0b1111:
                }
            },
            asm: function(cond,disp) {
                var op = 0xd000;

                // Accounting for the pipe stages of the Cortex M0
                disp = disp - 2;
                if (cond < 0 || cond > 14) {
                    asmmsg("Bcond condition must be 0-14");
                    return null;
                }
                if (!immed(disp, -2048, 2046))
                    return null;
                if (disp & 0x1) {
                    asmmsg("Displacement must be aligned \nwith 16-bit boundary.");
                    return null;
                }
                op |= (cond << 8);
                var imm8 = (disp >> 1) & 0xff;
                op |= imm8;
                return op;
            },
            dis: function(inst) {
                var cond = (inst >> 8) & 0xf;
                var imm8 = (inst & 0xff);

                var disp = imm8 << 1;

                // Accounting for the pipe stages of the Cortex M0
                if (disp & 0x100)
                    disp |= 0xfffffe00;

                disp = disp + 2;
                // We did only two so that we can calculate the addr
                // correctly, its a total mess
                var disassemblyPC = assembler.getTextPC();
                var addr = (disassemblyPC + disp) & 0xffffffff;
                var label = labels.findByAddr(addr);

                // We add another two so that we can display the correct
                // offsets
                disp = disp + 2;
                var str;
                if (label === null) {
                    if (disp & 0x80000000) {
                        var negdisp = (disp ^ 0xffffffff) + 1;
                        str = hex16(inst) + "      b" + condname(cond) + "     " + "pc - "
                            + negdisp.toString(10)  + " ; " + hex32(addr);
                    } else
                        str = hex16(inst) + "      b" + condname(cond) + "     " + "pc + "
                        + disp.toString(10) + " ; " + hex32(addr);
                } else
                    str = hex16(inst) + "      b" + condname(cond) + "     " + label;
                return str;
            }
        };

        var BEQ = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0000,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst);} };

        var BNE = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0001,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BCS = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0010,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BCC = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0011,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BMI = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0100,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BPL = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0101,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BVS = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0110,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BVC = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b0111,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BHI = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1000,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BLS = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1001,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BGE = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1010,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BLT = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1011,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BGT = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1100,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BLE = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1101,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };

        var BAL = { length: Bcond.length,
                    asm: function(disp) { return Bcond.asm(0b1110,disp); },
                    dis: function(inst) { return Bcond.dis(inst); },
                    exec: function(inst) { return Bcond.exec(inst); } };


        // Bitwise clear of Rdn by Rm
        var BIC2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var m = reg.read(rm);
                var val = reg.read(rdn);
                var result = val & ~m;
                reg.updateNZC(result&0x80000000, result===0, reg.getc())
                reg.write(rdn, result);
            },
            asm: function(rdn, rm) {
                var op = 0x4380;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      bics    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // BKPT (default argument)
        var BKPT = {
            length: 2,
            asm: function() {
                return BKPTI.asm(0);
            },
        };

        // BKPT #imm
        var BKPTI = {
            length: 2,
            exec: function(inst) {
                var imm = 0xff & inst;
                message("BKPT #" + imm.toString(10));
                reg.write(PC, reg.read(PC) - 2);
                simulator.stop();
                ui.stop();
            },
            asm: function(imm) {
                var op = 0xbe00;
                if (!immed(imm, 0, 255))
                    return null;
                op |= imm;
                return op;
            },
            dis: function(inst) {
                var imm = (inst & 0xff);
                var str = hex16(inst) + "      bkpt    #"
                    + imm.toString(10);
                return str;
            }
        };

        // BL #imm
        var BL = {
            length: 4,
            exec: function(inst) {
                // remember the byte format is reversed
                var imm11 = (inst >> 16) & 0x7ff;
                var imm10 = inst & 0x3ff;
                var s = (inst >> 10) & 0x1;
                var j1 = (inst >> (16+13)) & 0x1;
                var j2 = (inst >> (16+11)) & 0x1;
                var i1 = !(j1 ^ s);
                var i2 = !(j2 ^ s);
                var imm32 = imm11 << 1;
                imm32 |= imm10 << 12;
                imm32 |= i2 << 22;
                imm32 |= i1 << 23;
                imm32 |= s << 24;
                if (s)
                    imm32 |= 0xfe000000;
                reg.write(LR, reg.read(PC))
                reg.write(PC, reg.read(PC) + imm32);
            },
            asm: function(imm) {
                var op = 0xd000f000;
                if (!immed(imm, -16777216, 16777214))
                    return null;
                imm = imm >> 1;
                var imm11 = imm & 0x7ff;
                var imm10 = (imm >> 11) & 0x3ff;
                var i1 = (imm >> 21) & 0x1;
                var i2 = (imm >> 22) & 0x1;
                var s = (imm >> 23) & 0x1;
                var j1 = !(s ^ i1);
                var j2 = !(s ^ i2);
                op |= imm11 << 16;
                op |= j2 << (16 + 11);
                op |= j1 << (16 + 13);
                op |= imm10;
                op |= s << 10;
                return op;
            },
            dis: function(inst) {
                // remember the byte format is reversed
                var imm11 = (inst >> 16) & 0x7ff;
                var imm10 = inst & 0x3ff;
                var s = (inst >> 10) & 0x1;
                var j1 = (inst >> (16+13)) & 0x1;
                var j2 = (inst >> (16+11)) & 0x1;
                var i1 = !(j1 ^ s);
                var i2 = !(j2 ^ s);
                var imm32 = imm11 << 1;
                imm32 |= imm10 << 12;
                imm32 |= i2 << 22;
                imm32 |= i1 << 23;
                imm32 |= s << 24;
                var addr = assembler.getTextPC() + imm32;
                if (s)
                    imm32 |= 0xfe000000;
                var str = hex16(inst) + " " + hex16(inst>>16) + " bl      #"
                    + hex32(addr);
                return str;
            }
        };

        // Branch (always) with an 11-bit relative displacement.
        var BX = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 3) & 0xf;
                var addr = reg.read(rm);
                reg.write(PC, addr);
            },
            asm: function(rm) {
                var op = 0x4700;
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 3) & 0xf;
                var str = hex16(inst) + "      bx      " + regtoname(rm);
                return str;
            }
        };

        // Compare Negative two registers
        var CMN2 = {
            length: 2,
            exec: function(inst) {
                var rn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result,cout,ovf;
                var m = reg.read(rm);
                [result,cout,ovf] = AddWithCarry(reg.read(rn), m, 0);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
            },
            asm: function(rn, rm) {
                var op = 0x42c0;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= (rn << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rn = (inst >> 0) & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      cmn     " + regtoname(rn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Compare Rdn, #imm
        var CMP1I = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rdn = (inst >> 8) & 7;
                var result,cout,ovf;
                imm = imm ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rdn), imm, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
            },
            asm: function(rdn, imm) {
                var op = 0x2800;
                if (!smallreg(rdn))
                    return null;
                if (!immed(imm, 0, 255))
                    return null;
                op |= imm;
                op |= (rdn << 8);
                return op;
            },
            dis: function(inst) {
                var imm = inst & 0xff;
                var rdn = (inst >> 8) & 7;
                var str = hex16(inst) + "      cmp     " + regtoname(rdn)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Compare two small registers
        var CMP2 = {
            length: 2,
            exec: function(inst) {
                var rn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result,cout,ovf;
                var m = reg.read(rm);
                m = m ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rn), m, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
            },
            asm: function(rn, rm) {
                var op = 0x4280;
                if (rm > 7 || rn > 7)
                    return CMP2Big.asm(rn,rm);
                op |= (rn << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rn = (inst >> 0) & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      cmp     " + regtoname(rn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Compare two big registers
        var CMP2Big = {
            length: 2,
            exec: function(inst) {
                var rn = (inst & 7) | ((inst >> 4) & 8);
                var rm = (inst >> 3) & 0xf;
                var result,cout,ovf;
                var m = reg.read(rm);
                m = m ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rn), m, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
            },
            asm: function(rn, rm) {
                var op = 0x4500;
                if (!bigreg(rm) || !bigreg(rn))
                    return CMP2Big.asm(rn,rm);
                op |= (rn << 0) & 7;
                op |= (rn & 8) << 4;
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rn = (inst & 7) | ((inst >> 4) & 8);
                var rm = (inst >> 3) & 0xf;
                var str = hex16(inst) + "      cmp     " + regtoname(rn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Change processor state.  Disable interrupts.
        var CPSID = {
            length: 2,
            exec: function (inst) {
                message("CPSID not done.");
                stop();
                ui.stop();
            },
            asm: function() {
                return 0xb672;
            },
            dis: function (inst) {
                var str = hex16(inst) + "      cpsid";
                return str;
            }
        };

        // Change processor state.  Enable interrupts.
        var CPSIE = {
            length: 2,
            exec: function (inst) {
                message("CPSIE not done.");
                stop();
                ui.stop();
            },
            asm: function() {
                return 0xb662;
            },
            dis: function (inst) {
                var str = hex16(inst) + "      cpsie";
                return str;
            }
        };

        // Exclusive or three registers
        var EOR3 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rdn) ^ reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdn,result);
            },
            asm: function(rd, rn, rm) {
                var op = 0x4040;
                if(rd != rn)
                    return null;
                if (!smallreg(rn) || !smallreg(rm))
                    return null;
                op |= rn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      eors    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Exclusive or two registers
        var EOR2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rdn) ^ reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4040;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      eors    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Load register Rt from [Rn + Rn] (indirect)
        var LDR3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var addr = reg.read(rn) + reg.read(rm);
                var val = memory.read32(addr);
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5800;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      ldr     " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Load register Rt from zero-extended byte at [Rn + Rn] (indirect)
        var LDRB3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var addr = reg.read(rn) + reg.read(rm);
                var val = memory.read8(addr) & 0xff;
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5C00;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      ldrb    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Load register Rt from zero-extended halfword at [Rn + Rn] (indirect)
        var LDRH3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var addr = reg.read(rn) + reg.read(rm);
                var val = memory.read16(addr) & 0xffff;
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5a00;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      ldrh    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Load register Rt from [PC + #Imm] (literal)
        var LDRL = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rt = (inst >> 8) & 7;
                var base = reg.read(PC);

                // align base to 4 byte address
                if(base % 4 != 0)
                {
                    base += 2;
                }

                var addr =  base + (4 * imm);
                var val = memory.read32(addr);
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, imm) {
                var op = 0x4800;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 1020))
                    return null;
                op |= (imm >> 2);
                op |= (rt << 8);
                return op;
            },
            dis: function(inst) {
                var offset = (inst & 0xff) * 4;
                var rt = (inst >> 8) & 7;
                var label = labels.findByAddr(reg.read(PC) + offset);
                var str;
                if (label === null)
                    str = hex16(inst) + "      ldr     " + regtoname(rt)
                    + ", [pc, #" + offset.toString(10) + "]";
                else
                    str = hex16(inst) + "      ldr     " + regtoname(rt)
                    + label;
                return str;
            }
        };

        // Load register Rt from zero-extended byte at [Rn + #Imm] (indirect)
        var LDRBI = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var addr = reg.read(rn) + imm;
                var val = memory.read8(addr) & 0xff;
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, rn, imm) {
                var op = 0x7800;
                if (!smallreg(rn))
                    return null;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 31))
                    return null;
                op |= (imm >> 0) << 6;
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      ldrb    " + regtoname(rt)
                    + ", [" + regtoname(rn) + "]";
                else
                    str = hex16(inst) + "      ldrb    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Load register Rt from zero-extended halfword at [Rn + #Imm] (indirect)
        var LDRHI = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var addr = reg.read(rn) + (imm<<1);
                var val = memory.read16(addr) & 0xffff;
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, rn, imm) {
                var op = 0x8800;
                if (!smallreg(rn))
                    return null;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 62))
                    return null;
                if (!divisible(imm, 2))
                    return null;
                op |= (imm >> 1) << 6;
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var imm = ((inst >> 6) & 0x1f) << 1;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      ldrh    " + regtoname(rt)
                    + ", [" + regtoname(rn) + "]";
                else
                    str = hex16(inst) + "      ldrh    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Load register Rt from [Rn + #Imm] (indirect)
        var LDRI = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var addr = reg.read(rn) + 4*imm;
                var val = memory.read32(addr);
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, rn, imm) {
                if (rn === SP)
                    return LDRSI.asm(rt, imm);
                if (rn === PC)
                    return LDRL.asm(rt, imm);
                var op = 0x6800;
                if (!smallreg(rn))
                    return null;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 124))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (imm >> 2) << 6;
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var imm = ((inst >> 6) & 0x1f) * 4;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      ldr     " + regtoname(rt)
                    + ", [" + regtoname(rn) + "]";
                else
                    str = hex16(inst) + "      ldr     " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Load register Rt from sign-extended byte at [Rn + Rn] (indirect)
        var LDRSB3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var addr = reg.read(rn) + reg.read(rm);
                var val = memory.read8(addr);
                if (val === null)
                    return;
                if (val & 128)
                    val |= 0xffffff00;
                reg.write(rt, val);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5600;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      ldrsb   " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Load register Rt from sign-extended halfword at [Rn + Rn] (indirect)
        var LDRSH3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var addr = reg.read(rn) + reg.read(rm);
                var val = memory.read16(addr);
                if (val === null)
                    return;
                if (val & 32768)
                    val |= 0xffff0000;
                reg.write(rt, val);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5e00;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      ldrsh   " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Load register Rt from [SP + #Imm]
        var LDRSI = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rt = (inst >> 8) & 7;
                var addr = reg.read(SP) + 4*imm;
                var val = memory.read32(addr);
                if (val === null)
                    return;
                reg.write(rt, val);
            },
            asm: function(rt, imm) {
                var op = 0x9800;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 1020))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (imm >> 2);
                op |= (rt << 8);
                return op;
            },
            dis: function(inst) {
                var imm = (inst & 0xff) * 4;
                var rt = (inst >> 8) & 7;
                var str;
                str = hex16(inst) + "      ldr     " + regtoname(rt)
                    + ", [sp, #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Logical shift left Rdn by Rm
        var LSL2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var amount = reg.read(rm);
                var val = reg.read(rdn);
                var result,cout;

                if (amount === 0) {
                    cout = reg.getc();
                    result = val;
                } else if (amount > 32) {
                    result = 0;
                    cout = 0;
                } else {
                    cout = (val >> (32-amount)) & 1;
                    result = val << amount;
                }
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rdn, result);
            },
            asm: function(rdn, rm) {
                var op = 0x4080;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      lsls    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Logical shift left Rm by #imm and store in Rd
        var LSL2I = {
            length: 2,
            exec: function(inst) {
                var amount = (inst >> 6) & 0x1f;
                var rm = (inst >> 3) & 7;
                var rd = (inst >> 0) & 7;
                var value = reg.read(rm);
                var result,cout;

                if (amount == 0) {
                    cout = reg.getc();
                    result = value;
                } else {
                    cout = (value >> (32-amount)) & 1;
                    result = value << amount;
                }
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rd, result);
            },
            asm: function(rd, rm, imm) {
                var op = 0x0000;
                if (!smallreg(rd) || !smallreg(rm))
                    return null;
                if (!immed(imm, 0, 31))
                    return null;
                op |= (imm << 6);
                op |= (rd << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rm = (inst >> 3) & 7;
                var rd = (inst >> 0) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      "
                        + "movs    " + regtoname(rd)
                        + ", " + regtoname(rm);
                else
                    str = hex16(inst) + "      "
                        + "lsls    " + regtoname(rd)
                        + ", " + regtoname(rm)
                        + ", #" + imm.toString(10);
                return str;
            }
        };

        // Logical shift right Rdn by Rm
        var LSR2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var amount = reg.read(rm);
                var value = reg.read(rdn);
                var result,cout;

                if (amount === 0) {
                    cout = reg.getc();
                    result = value;
                } else if (amount > 32) {
                    result = 0;
                    cout = 0;
                } else {
                    cout = (value >> (amount-1)) & 1;
                    result = value >> amount;
                    var mask = 0xffffffff << (32-amount);
                    result = result & ~mask;
                }
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rdn, result);
            },
            asm: function(rdn, rm) {
                var op = 0x40C0;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      lsrs    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Logical shift right Rm by #imm and store in Rd
        var LSR2I = {
            length: 2,
            exec: function(inst) {
                var amount = (inst >> 6) & 0x1f;
                var rm = (inst >> 3) & 7;
                var rd = (inst >> 0) & 7;
                var value = reg.read(rm);
                var sign = (value >> 31) & 1;
                var result,cout;

                if (amount === 0)
                    amount = 32;
                if (amount === 32) {
                    cout = sign;
                } else {
                    result = (value >> (amount-1));
                    cout = result & 1;
                    result = result >> 1;
                }
                var mask = 0xffffffff << (32-amount);
                result = result & ~mask;
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rd, result);
            },
            asm: function(rd, rm, imm) {
                var op = 0x0800;
                if (!smallreg(rd) || !smallreg(rm))
                    return null;
                if (!immed(imm, 1, 32))
                    return null;
                if (imm === 32)
                    imm = 0;
                op |= (imm << 6);
                op |= (rd << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                if (imm === 0)
                    imm = 32;
                var rm = (inst >> 3) & 7;
                var rd = (inst >> 0) & 7;
                var str = hex16(inst) + "      "
                    + "lsrs    " + regtoname(rd)
                    + ", " + regtoname(rm)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Mov Rd, #imm
        var MOV1I = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rd = (inst >> 8) & 7;
                var result = imm;
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rd,result);
            },
            asm: function(rd, imm) {
                var op = 0x2000;
                if (!smallreg(rd))
                    return null;
                if (!immed(imm, 0, 255))
                    return null;
                op |= imm;
                op |= (rd << 8);
                return op;
            },
            dis: function(inst) {
                var imm = inst & 0xff;
                var rd = (inst >> 8) & 7;
                var str = hex16(inst) + "      movs    " + regtoname(rd)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Move Rm into Rd
        var MOV2 = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rd,result);
            },
            asm: function(rd, rm) {
                var op = 0x0000;
                if (!smallreg(rd) || !smallreg(rm))
                    return null;
                op |= rd << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      movs    "+regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Move LR into PC
        var MOV3 = {
            length: 2,
            exec: function(inst) {
                var rd = (inst & 7) | ((inst & 0x0080) >> 4);
                var rm = (inst >> 3) & 0xf;
                var result = reg.read(rm);
                reg.write(rd, result);
            },
            asm: function(rd, rm) {
                var op = 0x4600;
                op |= (rd & 7) | ((rd & 8) << 4);
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rd = (inst & 7) | ((inst >> 4) & 8);
                var rm = (inst >> 3) & 0xf;
                var str = hex16(inst) + "      mov     "+ regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Move Rm into Rd
        var MOV2Big = {
            length: 2,
            exec: function(inst) {
                var rd = (inst & 7) | ((inst >> 4) & 8);
                var rm = (inst >> 3) & 0xf;
                var result = reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rd,result);
            },
            asm: function(rd, rm) {
                var op = 0x4600;
                if (!bigreg(rd) || !bigreg(rm))
                    return MOV2Big.asm(rd, rm);
                op |= rd & 7;
                op |= (rd & 8) << 4;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rd = (inst & 7) | ((inst >> 4) & 8);
                var rm = (inst >> 3) & 0xf;
                var str = hex16(inst) + "      movs    "+regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Multiply two registers
        var MUL2 = {
            length: 2,
            exec: function(inst) {
                var rdm = inst & 7;
                var rn = (inst >> 3) & 7;
                var result = (reg.read(rdm) * reg.read(rn)) & 0xffffffff;
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdm,result);
            },
            asm: function(rdm, rn) {
                var op = 0x4340;
                if (!smallreg(rdm) || !smallreg(rn))
                    return null;
                op |= rdm << 0;
                op |= rn << 3;
                return op;
            },
            dis: function(inst) {
                var rdm = inst & 7;
                var rn = (inst >> 3) & 7;
                var str = hex16(inst) + "      muls    "+regtoname(rdm)
                    + ", " + regtoname(rn);
                return str;
            }
        };

        // Move NOT Rm into Rd
        var MVN2 = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = (~reg.read(rm)) & 0xffffffff;
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rd,result);
            },
            asm: function(rdm, rn) {
                var op = 0x43C0;
                if (!smallreg(rdm) || !smallreg(rn))
                    return null;
                op |= rdm << 0;
                op |= rn << 3;
                return op;
            },
            dis: function(inst) {
                var rdm = inst & 7;
                var rn = (inst >> 3) & 7;
                var str = hex16(inst) + "      mvns    "+regtoname(rdm)
                    + ", " + regtoname(rn);
                return str;
            }
        };

        // Canonical no-op
        var NOP = {
            length: 2,
            exec: function (inst) {
            },
            asm: function () {
                var op = 0xbf00;
                return op;
            },
            dis: function (inst) {
                return hex16(inst) + "      nop";
            }
        };

        // Negate
        var NEG2 = {
            length: 2,
            asm: function (rd, rm) {
                return RSB2I.asm(rd,rm,0);
            }
        };

        // Or two registers
        var ORR3 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rdn) | reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdn,result);
            },
            asm: function(rd, rn, rm) {
                if(rd != rn)
                    return null;

                var op = 0x4300;
                if (!smallreg(rn) || !smallreg(rm))
                    return null;
                op |= rn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      orrs    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Or two registers
        var ORR2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rdn) | reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4300;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      orrs    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // POP instruction
        var POP = {
            length: 2,
            exec: function (inst) {
                var count = 0;
                for (var i = 0; i < 9; i += 1)
                    if (inst & (1<<i))
                        count += 1;
                var sp = reg.read(SP);
                var addr = sp;
                for (var i = 0; i < 9; i += 1)
                    if (inst & (1<<i)) {
                        reg.tick();
                        var value = memory.read32(addr);
                        if (value === null)
                            return;
                        if (i === 8)
                            reg.write(PC, value);
                        else
                            reg.write(i, value);
                        addr += 4;
                    }
                reg.write(SP, sp + (4*count));
            },
            asm: function (list) {
                var op = 0xbc00;
                for(var i=0; i<list.length; i += 1) {
                    if (list[i] === PC)
                        op |= 1<<8;
                    else if (list[i] >= 0 && list[i] <= 7)
                        op |= 1<< list[i];
                    else {
                        message("Bad register in list: " + regtoname(list[i]));
                        return null;
                    }
                }
                return op;
            },
            dis: function (inst) {
                var str = hex16(inst) + "      pop     ";
                inst &= 0x1ff;
                if (inst & 0x100) {
                        inst &= 0xff;
                        inst |= 1<<15;
                }
                str += regtolist(inst);
                return str;
            }
        };

        // PUSH instruction
        var PUSH = {
            length: 2,
            exec: function (inst) {
                var count = 0;
                for (var i = 0; i < 9; i += 1)
                    if (inst & (1<<i))
                        count += 1;
                var sp = reg.read(SP);
                var addr = sp - (4 * count);
                for (var i = 0; i < 9; i += 1)
                    if (inst & (1<<i)) {
                        reg.tick();
                        var value = 0;
                        if (i === 8)
                            value = reg.read(LR);
                        else
                            value = reg.read(i);
                        if (memory.write32(addr, value) === null)
                            return;
                        addr += 4;
                    }
                reg.write(SP, sp - (4*count));
            },
            asm: function (list) {
                var op = 0xb400;
                for(var i=0; i<list.length; i += 1) {
                    if (list[i] == LR)
                        op |= 1<<8;
                    else if (list[i] >= 0 && list[i] <= 7)
                        op |= 1<< list[i];
                    else {
                        message("Bad register in list: " + regtoname(list[i]));
                        return null;
                    }
                }
                return op;
            },
            dis: function (inst) {
                var str = hex16(inst) + "      push    ";
                inst = inst & 0x1ff;
                if (inst & 0x100) {
                        inst &= 0xff;
                        inst |= 1<<14;
                }
                str += regtolist(inst);
                return str;
            }
        };

        // REV
        var REV = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm);
                var result = 0;
                result |= ((value >>  0) & 0xff) << 24;
                result |= ((value >>  8) & 0xff) << 16;
                result |= ((value >> 16) & 0xff) <<  8;
                result |= ((value >> 24) & 0xff) <<  0;
                reg.write(rd, result);
            },
            asm: function(rd, rm) {
                var op = 0xba00;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "rev     " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // REV16
        var REV16 = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm);
                var result = 0;
                result |= ((value >> 16) & 0xff) << 24;
                result |= ((value >> 24) & 0xff) << 16;
                result |= ((value >>  0) & 0xff) <<  8;
                result |= ((value >>  8) & 0xff) <<  0;
                reg.write(rd, result);
            },
            asm: function(rd, rm) {
                var op = 0xba40;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "rev16   " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // REVSH
        var REVSH = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm);
                var result = 0;
                result |= ((value >>  8) & 0xff) <<  0;
                if (result & 0x80)
                    result |= 0xffffff00;
                reg.write(rd, result);
            },
            asm: function(rd, rm) {
                var op = 0xbac0;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "revsh   " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Reverse Subtract Rm from #Imm and store in Rd.  (Imm must be zero)
        var RSB2I = {
            asm: function(rd, rm, imm) {
                if (imm !== 0) {
                    asmmsg("RSB Immediate value must be zero");
                    return null;
                }
                return RSB2.asm(rd,rm);
            }
        };

        // Reverse Subtract Rm from #0 and store in Rd
        var RSB2 = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 7;
                var rn = (inst >> 3) & 7;
                var n = (~reg.read(rn)) & 0xffffffff;
                var result,cout,ovf;
                [result,cout,ovf] = AddWithCarry(n, 0, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rd, result);
            },
            asm: function(rd, rm) {
                var op = 0x4240;
                if (!smallreg(rd) || !smallreg(rm))
                    return null;
                op |= rd << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      negs    "+regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Rotate right Rdn by Rm
        var ROR2 = {
            length: 2,
            exec: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var amount = reg.read(rm);
                var value = reg.read(rdn);
                var result,cout;

                amount = amount & 0x1f;
                if (amount === 0) {
                    cout = reg.getc();
                    result = value;
                } else {
                    result = ((value >> amount) & ((1<<(32-amount))-1))
                        | ((value << (32-amount)) & (0xffffffff - ((1<<(32-amount))-1)));
                    cout = (result >> 31) & 1;
                }
                reg.updateNZC(result&0x80000000, result===0, cout);
                reg.write(rdn, result);
            },
            asm: function(rdn, rm) {
                var op = 0x41c0;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= rdn << 0;
                op |= rm << 3;
                return op;
            },
            dis: function(inst) {
                var rdn = inst & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      rors    "+regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Subtract two registers with carry-in
        var SBC2 = {
            length: 2,
            exec: function(inst) {
                var rdn = (inst & 7);
                var rm = (inst >> 3) & 0x7;
                var result,cout,ovf;
                var m = reg.read(rm) ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rdn), m, reg.getc());
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rdn,result);
            },
            asm: function(rdn, rm) {
                var op = 0x4180;
                if (!smallreg(rdn) || !smallreg(rm))
                    return null;
                op |= (rdn << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rdn = (inst & 7);
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      sbcs    " + regtoname(rdn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Send Event hint
        var SEV = {
            length: 2,
            exec: function (inst) {
                // TODO: Not right yet.
            },
            asm: function () {
                var op = 0xbf40;
                return op;
            },
            dis: function (inst) {
                return hex16(inst) + "      sev";
            }
        };

        // Store register Rt to [Rn + Rn] (indirect)
        var STR3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var value = reg.read(rt);
                var addr = reg.read(rn) + reg.read(rm);
                memory.write32(addr, value);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5000;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      str     " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Store low byte of register Rt to [Rn + Rn] (indirect)
        var STRB3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var value = reg.read(rt);
                var addr = reg.read(rn) + reg.read(rm);
                memory.write8(addr, value);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5400;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      strb    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Store low halfword of register Rt to [Rn + Rn] (indirect)
        var STRH3 = {
            length: 2,
            exec: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var value = reg.read(rt);
                var addr = reg.read(rn) + reg.read(rm);
                memory.write16(addr, value);
            },
            asm: function(rt, rn, rm) {
                var op = 0x5200;
                if (!smallreg(rn) || !smallreg(rm) || !smallreg(rt))
                    return null;
                op |= (rm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rt = (inst >> 0) & 7;
                var str;
                str = hex16(inst) + "      strh    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", " + regtoname(rm) + "]";
                return str;
            }
        };

        // Store register Rt to [Rn + #Imm] (indirect)
        var STRI = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var value = reg.read(rt);
                var addr = reg.read(rn) + (4 * imm);
                memory.write32(addr, value);
            },
            asm: function(rt, rn, imm) {
                if (rn === SP)
                    return STRSI.asm(rt, imm);
                var op = 0x6000;
                if (!smallreg(rn))
                    return null;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 124))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (imm >> 2) << 6;
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var imm = ((inst >> 6) & 0x1f) * 4;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      str     " + regtoname(rt)
                    + ", [" + regtoname(rn) + "]";
                else
                    str = hex16(inst) + "      str     " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Store lower byte of register Rt to [Rn + #Imm] (indirect)
        var STRBI = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var value = reg.read(rt);
                var addr = reg.read(rn) + (imm);
                memory.write8(addr, value);
            },
            asm: function(rt, rn, imm) {
                var op = 0x7000;
                if (!smallreg(rn))
                    return null;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 124))
                    return null;
                op |= (imm << 6);
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      strb    " + regtoname(rt)
                    + ", [" + regtoname(rn) + "]";
                else
                    str = hex16(inst) + "      strb    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Store lower halfword of register Rt to [Rn + #Imm] (indirect)
        var STRHI = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 0x1f;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var value = reg.read(rt);
                var addr = reg.read(rn) + (imm<<1);
                memory.write16(addr, value);
            },
            asm: function(rt, rn, imm) {
                var op = 0x8000;
                if (!smallreg(rn))
                    return null;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 62))
                    return null;
                if (!divisible(imm, 2))
                    return null;
                op |= (imm >> 1) << 6;
                op |= (rn << 3);
                op |= (rt << 0);
                return op;
            },
            dis: function(inst) {
                var imm = ((inst >> 6) & 0x1f) * 2;
                var rt = (inst >> 0) & 7;
                var rn = (inst >> 3) & 7;
                var str;
                if (imm === 0)
                    str = hex16(inst) + "      strh    " + regtoname(rt)
                    + ", [" + regtoname(rn) + "]";
                else
                    str = hex16(inst) + "      strh    " + regtoname(rt)
                    + ", [" + regtoname(rn) + ", #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Store register Rt to [SP + #Imm]
        var STRSI = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rt = (inst >> 8) & 7;
                var addr = reg.read(SP) + 4*imm;
                var value = reg.read(rt);
                memory.write32(addr, value);
            },
            asm: function(rt, imm) {
                var op = 0x9000;
                if (!smallreg(rt))
                    return null;
                if (!immed(imm, 0, 1020))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (imm >> 2);
                op |= (rt << 8);
                return op;
            },
            dis: function(inst) {
                var imm = (inst & 0xff) * 4;
                var rt = (inst >> 8) & 7;
                var str;
                str = hex16(inst) + "      str     " + regtoname(rt)
                    + ", [sp, #" + imm.toString(10) + "]";
                return str;
            }
        };

        // Sub Rd, Rn, #imm
        var SUB2I = {
            length: 2,
            exec: function(inst) {
                var imm = (inst >> 6) & 7;
                var rd = inst & 7;
                var rn = (inst >> 3) & 7;
                var result, cout, ovf;
                imm = imm ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rn), imm, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rd, result);
            },
            asm: function(rd, rn, imm) {
                var op = 0x1e00;
                if (!smallreg(rd) || !smallreg(rn))
                    return null;
                if (!immed(imm, 0, 7))
                    return null;
                op |= (imm << 6);
                op |= (rn << 3);
                op |= (rd << 0);
                return op;
            },
            dis: function(inst) {
                var imm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var rd = inst & 7;
                var str = hex16(inst) + "      subs    " + regtoname(rd)
                    + ", " + regtoname(rn)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Subs Rdn, #imm
        var SUB1I = {
            length: 2,
            exec: function(inst) {
                var imm = inst & 0xff;
                var rdn = (inst >> 8) & 7;
                var result,cout,ovf;
                imm = imm ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rdn), imm, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rdn, result);
            },
            asm: function(rdn, imm) {
                var op = 0x3800;
                if (!smallreg(rdn))
                    return null;
                if (!immed(imm, 0, 255))
                    return null;
                op |= imm;
                op |= (rdn << 8);
                return op;
            },
            dis: function(inst) {
                var imm = inst & 0xff;
                var rdn = (inst >> 8) & 7;
                var str = hex16(inst) + "      subs    " + regtoname(rdn)
                    + ", #" + imm.toString(10);
                return str;
            }
        };

        // Subtract three registers
        var SUB3 = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 7;
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var result,cout,ovf;
                var m = reg.read(rm);
                m = m ^ 0xffffffff;
                [result,cout,ovf] = AddWithCarry(reg.read(rn), m, 1);
                reg.updateNZCV(result&0x80000000, result===0, cout, ovf);
                reg.write(rd,result);
            },
            asm: function(rd, rn, rm) {
                var op = 0x1a00;
                if (!smallreg(rd) || !smallreg(rm) || !smallreg(rn)) {
                    return null;
                }
                op |= (rd << 0);
                op |= (rm << 6);
                op |= (rn << 3);
                return op;
            },
            dis: function(inst) {
                var rd = (inst >> 0) & 7;
                var rm = (inst >> 6) & 7;
                var rn = (inst >> 3) & 7;
                var str = hex16(inst) + "      subs    " + regtoname(rd)
                    + ", " + regtoname(rn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Subtract two registers
        var SUBS2 = {
            length: 2,
            asm: function(rd, rm) {
                return SUB3.asm(rd,rd,rm);
            }
        };

        // SUB SP #imm
        var SUB_SI = {
            length: 2,
            exec: function(inst) {
                var imm = 0x7f & inst;
                reg.write(SP, reg.read(SP) - (4 * imm));
            },
            asm: function(reg,imm) {
                var op = 0xb080;
                if (reg != SP) {
                    asmmsg("Cannot use " + regtoname(r) + ".  Only SP.");
                    return null;
                }
                if (!immed(imm, 0, 508))
                    return null;
                if (!divisible(imm, 4))
                    return null;
                op |= (imm >> 2);
                return op;
            },
            dis: function(inst) {
                var imm = (inst & 0x7f) * 4;
                var str = hex16(inst) + "      sub     sp, sp, #"
                    + imm.toString(10);
                return str;
            }
        };

        // SUB SP, SP, #imm
        var SUBSSI = {
            length: 2,
            asm: function(rd,rm,imm) {
                if (rd != SP) {
                    asmmsg("Cannot use " + regtoname(rd) + ". Only SP.");
                    return null;
                }
                if (rm != SP) {
                    asmmsg("Cannot use " + regtoname(rm) + ". Only SP.");
                    return null;
                }
                return SUB_SI.asm(rd,imm);
            }
        }

        // SXTB
        var SXTB = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm) & 0xff;
                if (value & 0x80)
                    value |= 0xffffff00;
                reg.write(rd, value);
            },
            asm: function(rd, rm) {
                var op = 0xb240;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "sxtb    " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // SXTH
        var SXTH = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm) & 0xffff;
                if (value & 0x8000)
                    value |= 0xffff0000;
                reg.write(rd, value);
            },
            asm: function(rd, rm) {
                var op = 0xb200;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "sxth    " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Test two registers
        var TST2 = {
            length: 2,
            exec: function(inst) {
                var rn = inst & 7;
                var rm = (inst >> 3) & 7;
                var result = reg.read(rn) & reg.read(rm);
                reg.updateNZ(result&0x80000000, result===0);
            },
            asm: function(rn, rm) {
                var op = 0x4200;
                if (!smallreg(rm) || !smallreg(rn))
                    return null;
                op |= (rn << 0);
                op |= (rm << 3);
                return op;
            },
            dis: function(inst) {
                var rn = (inst >> 0) & 7;
                var rm = (inst >> 3) & 7;
                var str = hex16(inst) + "      cmp     " + regtoname(rn)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Undefined instruction.
        var UNDEF16 = {
            length: 2,
            exec: function (inst) {
                message("decode_undef not done.");
                stop();
                ui.stop();
            },
            dis: function (inst) {
                var str = hex16(inst) + "      ????";
                return str;
            }
        };

        // UXTB
        var UXTB = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm) & 0xff;
                reg.write(rd, value);
            },
            asm: function(rd, rm) {
                var op = 0xb2c0;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "uxtb    " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // UXTH
        var UXTH = {
            length: 2,
            exec: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var value = reg.read(rm) & 0xffff;
                reg.write(rd, value);
            },
            asm: function(rd, rm) {
                var op = 0xb200;
                if (!smallreg(rd))
                    return null;
                if (!smallreg(rm))
                    return null;
                op |= (rm << 3) | rd;
                return op;
            },
            dis: function(inst) {
                var rd = inst & 0x7;
                var rm = (inst >> 3) & 0x7;
                var str = hex16(inst) + "      " +
                    "uxth    " + regtoname(rd)
                    + ", " + regtoname(rm);
                return str;
            }
        };

        // Wait for event hint
        var WFE = {
            length: 2,
            exec: function (inst) {
                // TODO: Not right yet.
                reg.write(PC, reg.read(PC) - 2);
                simulator.stop();
                ui.stop();
            },
            asm: function () {
                var op = 0xbf20;
                return op;
            },
            dis: function (inst) {
                return hex16(inst) + "      wfe";
            }
        };

        // Wait for interrupt hint
        var WFI = {
            length: 2,
            exec: function (inst) {
                // TODO: Not right yet.
                reg.write(PC, reg.read(PC) - 2);
                simulator.stop();
                ui.stop();
            },
            asm: function () {
                var op = 0xbf30;
                return op;
            },
            dis: function (inst) {
                return hex16(inst) + "      wfi";
            }
        };

        // Yield hint
        var YIELD = {
            length: 2,
            exec: function (inst) {
                // TODO: Not right yet.
            },
            asm: function () {
                var op = 0xbf10;
                return op;
            },
            dis: function (inst) {
                return hex16(inst) + "      yield";
            }
        };

        function decode_shift_add_move_compare(inst) {
            var op = (inst >> 9) & 0x1f;
            var subop = (op >> 2) & 0x7;
            switch(subop) {
            case 0b000: return LSL2I;
            case 0b001: return LSR2I;
            case 0b010: return ASR2I;
            case 0b011:
                switch(op) {
                case 0b01100: return ADD3;
                case 0b01101: return SUB3;
                case 0b01110: return ADD2I;
                case 0b01111: return SUB2I;
                }
            case 0b100: return MOV1I;
            case 0b101: return CMP1I;
            case 0b110: return ADD1I;
            case 0b111: return SUB1I;
            }
        }

        function decode_special(inst) {
            var op = (inst >> 6) & 0xf;
            switch(op) {
            case 0b0000: return ADD2;
            case 0b0001: return ADD2;
            case 0b0010: return ADD2;
            case 0b0011: return ADD2;

            case 0b0100: return CMP2Big;
            case 0b0101: return CMP2Big;
            case 0b0110: return CMP2Big;
            case 0b0111: return CMP2Big;

            case 0b1000: return MOV3;
            case 0b1001: return MOV3;
            case 0b1010: return MOV3;
            case 0b1011: return MOV3;

            case 0b1100: return BX;
            case 0b1101: return BX;
            case 0b1110: return UNDEF16; // Should be BLX
            case 0b1111: return UNDEF16; // Should be BLX
            }

        }

        function decode_data_proc(inst) {
            var op = (inst >> 6) & 0xf;
            switch(op) {
            case 0b0000: return AND2;
            case 0b0001: return EOR2;
            case 0b0010: return LSL2;
            case 0b0011: return LSR2;
            case 0b0100: return ASR2;
            case 0b0101: return ADC2;
            case 0b0110: return SBC2;
            case 0b0111: return ROR2;
            case 0b1000: return TST2;
            case 0b1001: return RSB2;
            case 0b1010: return CMP2;
            case 0b1011: return CMN2;
            case 0b1100: return ORR2;
            case 0b1101: return MUL2;
            case 0b1110: return BIC2;
            case 0b1111: return MVN2;
            }
        }

        function decode_load_store(inst) {
            var opa = (inst >> 12) & 0xf;
            var opb = (inst >> 9) & 0x7;
            switch (opa) {
            case 0b0101:
                switch (opb) {
                case 0b000: return STR3;
                case 0b001: return STRH3;
                case 0b010: return STRB3;
                case 0b011: return LDRSB3;
                case 0b100: return LDR3;
                case 0b101: return LDRH3;
                case 0b110: return LDRB3;
                case 0b111: return LDRSH3;
                }
            case 0b0110:
                if ((opb & 0b100) === 0)
                    return STRI;
                else
                    return LDRI;
            case 0b0111:
                if ((opb & 0b100) === 0)
                    return STRBI;
                else
                    return LDRBI;
            case 0b1000:
                if ((opb & 0b100) === 0)
                    return STRHI;
                else
                    return LDRHI;
            case 0b1001:
                if ((opb & 0b100) === 0)
                    return STRSI;
                else
                    return LDRSI;
            default: return UNDEF16;
            }
        }

        function decode_sp_relative(inst) {
            if (inst & (1<<11))
                return ADD_RSI;
            return UNDEF16;
        }

        function decode_hints(inst) {
            var opa = (inst >> 4) & 0xf;
            var opb = (inst >> 0) & 0xf;
            switch(opa) {
            case 0b0000: return NOP;
            case 0b0001: return YIELD;
            case 0b0010: return WFE;
            case 0b0011: return WFI;
            case 0b0100: return SEV;
            default: return NOP;
            }
        }

        function decode_misc(inst) {
            var op = (inst & 0x0fc0) >> 6;
            switch (op) {
            case 0b000000: return ADD_SI;
            case 0b000001: return ADD_SI;

            case 0b000010: return SUB_SI;
            case 0b000011: return SUB_SI;

            case 0b001000: return SXTH;
            case 0b001001: return SXTB;
            case 0b001010: return UXTH;
            case 0b001011: return UXTB;

            case 0b010000: return PUSH;
            case 0b010001: return PUSH;
            case 0b010010: return PUSH;
            case 0b010011: return PUSH;
            case 0b010100: return PUSH;
            case 0b010101: return PUSH;
            case 0b010110: return PUSH;
            case 0b010111: return PUSH;

            case 0b011001:
                if (inst === 0xb662) return CPSIE;
                if (inst === 0xb672) return CPSID;
                else return UNDEF16;

            case 0b101000: return REV;
            case 0b101001: return REV16;
            case 0b101011: return REVSH;

            case 0b110000: return POP;
            case 0b110001: return POP;
            case 0b110010: return POP;
            case 0b110011: return POP;
            case 0b110110: return POP;
            case 0b110101: return POP;
            case 0b110100: return POP;
            case 0b110111: return POP;

            case 0b111000: return BKPTI;
            case 0b111001: return BKPTI;
            case 0b111010: return BKPTI;
            case 0b111011: return BKPTI;

            case 0b111100: return decode_hints(inst);
            case 0b111101: return decode_hints(inst);
            case 0b111110: return decode_hints(inst);
            case 0b111111: return decode_hints(inst);

            default: return UNDEF16;
            }
        }

        function decode_cond_branch_svc(inst) {
            var op = (inst & 0x0f00) >> 8;
            switch(op) {
            case 0b0000: return BEQ;
            case 0b0001: return BNE;
            case 0b0010: return BCS;
            case 0b0011: return BCC;
            case 0b0100: return BMI;
            case 0b0101: return BPL;
            case 0b0110: return BVS;
            case 0b0111: return BVC;
            case 0b1000: return BHI;
            case 0b1001: return BLS;
            case 0b1010: return BGE;
            case 0b1011: return BLT;
            case 0b1100: return BGT;
            case 0b1101: return BLE;
            case 0b1110: return UNDEF16;
            //case 0b1111: return SVC;
            }
            return UNDEF16;
        }

        function decode(inst) {
            var op = (inst & 0xfc00) >> 10;
            switch(op) {
            case 0b000000: return decode_shift_add_move_compare(inst);
            case 0b000001: return decode_shift_add_move_compare(inst);
            case 0b000010: return decode_shift_add_move_compare(inst);
            case 0b000011: return decode_shift_add_move_compare(inst);
            case 0b000100: return decode_shift_add_move_compare(inst);
            case 0b000101: return decode_shift_add_move_compare(inst);
            case 0b000110: return decode_shift_add_move_compare(inst);
            case 0b000111: return decode_shift_add_move_compare(inst);
            case 0b001000: return decode_shift_add_move_compare(inst);
            case 0b001001: return decode_shift_add_move_compare(inst);
            case 0b001010: return decode_shift_add_move_compare(inst);
            case 0b001011: return decode_shift_add_move_compare(inst);
            case 0b001100: return decode_shift_add_move_compare(inst);
            case 0b001101: return decode_shift_add_move_compare(inst);
            case 0b001110: return decode_shift_add_move_compare(inst);
            case 0b001111: return decode_shift_add_move_compare(inst);

            case 0b010000: return decode_data_proc(inst);
            case 0b010001: return decode_special(inst);

            case 0b010010: return LDRL;
            case 0b010011: return LDRL;

            case 0b010100: return decode_load_store(inst);
            case 0b010101: return decode_load_store(inst);
            case 0b010110: return decode_load_store(inst);
            case 0b010111: return decode_load_store(inst);

            case 0b011000: return decode_load_store(inst);
            case 0b011001: return decode_load_store(inst);
            case 0b011010: return decode_load_store(inst);
            case 0b011011: return decode_load_store(inst);
            case 0b011100: return decode_load_store(inst);
            case 0b011101: return decode_load_store(inst);
            case 0b011110: return decode_load_store(inst);
            case 0b011111: return decode_load_store(inst);

            case 0b100000: return decode_load_store(inst);
            case 0b100001: return decode_load_store(inst);
            case 0b100010: return decode_load_store(inst);
            case 0b100011: return decode_load_store(inst);
            case 0b100100: return decode_load_store(inst);
            case 0b100101: return decode_load_store(inst);
            case 0b100110: return decode_load_store(inst);
            case 0b100111: return decode_load_store(inst);

            case 0b101000: return ADR;
            case 0b101001: return ADR;

            case 0b101010: return decode_sp_relative(inst);
            case 0b101011: return decode_sp_relative(inst);

            case 0b101100: return decode_misc(inst);
            case 0b101101: return decode_misc(inst);
            case 0b101110: return decode_misc(inst);
            case 0b101111: return decode_misc(inst);

                //case 0b110000: return decode_store_multi(inst);
                //case 0b110001: return decode_store_multi(inst);

                //case 0b110010: return decode_load_multi(inst);
                //case 0b110011: return decode_load_multi(inst);

            case 0b110100: return decode_cond_branch_svc(inst);
            case 0b110101: return decode_cond_branch_svc(inst);
            case 0b110110: return decode_cond_branch_svc(inst);
            case 0b110111: return decode_cond_branch_svc(inst);

            case 0b111000: return B;
            case 0b111001: return B;

                //case 0b111010: return decode_undef(inst);
                //case 0b111011: return decode_undef(inst);

            case 0b111100: return BL;
            case 0b111101: return BL;

                //case 0b111110: return decode_undef(inst);
                //case 0b111111: return decode_undef(inst);

            default: UNDEF16;
            }
        }

        function parsereg(str) {
            var match_data;
            if (str[0] === "r") {
                match_data = str.match(/^r([0-9]+)/i);
                if (match_data) {
                    return parseInt(match_data[1], 10);
                }
                asmmsg("Bad register number: r" + match_data[1]);
                return -1;
            } else {
                match_data = str.match(/^(\w+)/);
                if (match_data[1] === "sp")
                    return SP;
                if (match_data[1] === "lr")
                    return LR;
                if (match_data[1] === "pc")
                    return PC;
                if (match_data[1] === "APSR")
                    return APSR;
                asmmsg("Bad register name " + match_data[1]);
                return -1;
            }
        }

        function adaptImmediateToDiffNumFormats(param) {
            var num = param.match(/0[xX][0-9a-fA-F]+/);
            if(num != null) {
                var stuff = num[0].replace(/0[xX]([0-9a-fA-F]+)/, '$1')
                var dec_val = parseInt(stuff, 16).toString();
                param = param.replace(/0[xX][0-9a-fA-F]+/, dec_val);
            }

            return param;
        }

        function parseReglist(param, impl) {
            var list=[];
            var str="";

            param = param.replace(/^{\s*/, "");
            var match_data = param.match(/^(r[0-7]|lr|pc)/i);
            while (match_data) {
                //message("param is '" + param + "'");
                //message("match is '" + match_data[1] + "'");
                var reg1 = parsereg(match_data[1]);
                list.push( reg1 );
                param = param.replace(/^(r[0-7]|lr|pc)\s*/i, "");
                match_data = param.match(/^-\s*/);
                if (match_data) {
                    param = param.replace(/^-\s*/, "");
                    match_data = param.match(/^(r[0-7])/i);
                    var reg2 = parsereg(match_data[1]);
                    if (reg1 < reg2) {
                        var x;
                        for(x=reg1+1; x <= reg2; x++)
                            list.push( x );
                    } else if (reg2 <= reg1) {
                        asmmsg("Bad register list '" + regtoname(reg1) +
                               "-" + regtoname(reg2) + "'");
                        var x;
                        for(x=reg2; x < reg1; x++)
                            list.push( x );
                    } else {
                        asmmsg("Bad register list '" + regtoname(reg1) +
                               "-" + regtoname(reg2) + "'");
                    }
                    param = param.replace(/^r[0-7]/i, "");
                }
                match_data = param.match(/^(,\s*)/i);
                if (match_data) {
                    param = param.replace(/^,\s*/i, "");
                    match_data = param.match(/^(r[0-7]|lr|pc)/i);
                    continue;
                }
                match_data = param.match(/^}/i);
                if (match_data) {
                    if (match_data[0] === "}") {
                        //message("Match at }");
                        break;
                    }
                }
                match_data = param.match(/^(r[0-7]|lr|pc)/i);
            }

            var prev = -1;
            for(var i=0; i<list.length; i+=1) {
                if (prev === -1) {
                        prev = list[i];
                        continue;
                }
                if (list[i] < prev)
                        asmmsg("Register list out of order: " +
                               regtoname(prev) + "," + regtoname(list[i]));
                prev = list[i];
            }
            //str = "parseReglist: ";
            //for(var i=0; i<list.length; i+=1)
            //    str += list[i].toString(10) + " ";
            //message(str);

            return impl.asm(list);
        }

        function checkReglist(param, impl, codeArr, symbols) {
            if (impl === null) { return false; }

            //message("checkReglist param is '" + param + "'");
            var match_data = param.match(/^{\s*(r[0-7](\s*-\s*r[0-7])?|lr|pc)(\s*,\s*(r[0-7](\s*-\s*r[0-7])?|lr|pc))*\s*}$/i);
            if (match_data)
                return parseReglist(match_data[0], impl);
            return null;
        }

        function checkRI(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            //message("checkSPimm param is '" + param + "'");
            param = adaptImmediateToDiffNumFormats(param);
            var match_data = param.match(/^(r[0-9]+|sp|lr|pc)\s*,\s*#[0-9]+$/i);
            if (match_data) {
                var regnum = parsereg(param);
                param = param.replace(/^[^#]+#/,"");
                var imm = parseInt(param,10);
                return impl.asm(regnum,imm);
            }
            return null;
        }

        // Check the form 1-register, iNdirect [ 1-register, immediate ]
        function check1N1I(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            //message("check1N1I param is '" + param + "'");
            var match_data = param.match(/^(r[0-9]+|sp|lr|pc)\s*,\s*\[\s*(r[0-9]+|sp|pc)\s*,\s*#([0-9]+)\s*\]$/i);
            if (match_data) {
                var rd = parsereg(match_data[1]);
                var rbase = parsereg(match_data[2]);
                var imm = parseInt(match_data[3],0);
                return impl.asm(rd, rbase, imm);
            }
            match_data = param.match(/^(r[0-9]+|sp|lr|pc)\s*,\s*\[\s*(r[0-9]+|sp|pc)\s*\]$/i);
            if (match_data) {
                var rd = parsereg(match_data[1]);
                var rbase = parsereg(match_data[2]);
                return impl.asm(rd, rbase, 0);
            }
            return null;
        }

        // Check the form 1-register, iNdirect [ 2-register ]
        function check1N2(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            //message("check1N2 param is '" + param + "'");
            var match_data = param.match(/^(r[0-9]+)\s*,\s*\[\s*(r[0-9]+)\s*,\s*(r[0-9]+)/);
            if (match_data) {
                var rd = parsereg(match_data[1]);
                var rn = parsereg(match_data[2]);
                var rm = parsereg(match_data[3]);
                return impl.asm(rd, rn, rm);
            }
            return null;
        }

        function checkRR(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            //message("checkRR param is '" + param + "'");
            var match_data = param.match(/^(r[0-9]+|sp|lr|pc)\s*,\s*(r[0-9]+|sp|lr|pc)$/i);
            if (match_data) {
                var r1 = parsereg(param);
                param = param.replace(/^(r[0-9]+|sp|lr|pc)\s*,\s*/,"");
                var r2 = parsereg(param);
                return impl.asm(r1, r2);
            }
            return null;
        }

        function checkRRI(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            //message("checkRRI param is '" + param + "'");
            param = adaptImmediateToDiffNumFormats(param);
            var match_data = param.match(/^(r[0-9]+|sp|lr|pc)\s*,\s*(r[0-9]+|sp|lr|pc)\s*,\s*#[0-9]+$/i);
            if (match_data) {
                var r1 = parsereg(param);
                param = param.replace(/[^,]+[,]\s*/,"");
                var r2 = parsereg(param);
                param = param.replace(/^[^#]+#/,"");
                var imm = parseInt(param,10);
                return impl.asm(r1, r2, imm);
            }
            return null;
        }

        function checkRRR(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            //message("checkRRR param is '" + param + "'");
            var match_data = param.match(/^(r[0-9]+|sp|lr|pc)\s*,\s*(r[0-9]+|sp|lr|pc)\s*,\s*(r[0-9]+|sp|lr|pc)$/i);
            if (match_data) {
                var r1 = parsereg(match_data[1]);
                var r2 = parsereg(match_data[2]);
                var r3 = parsereg(match_data[3]);
                return impl.asm(r1, r2, r3);
            }
            return null;
        }

        function checkRel(param, impl, codeArr, symbols, displayMsg) {
            if (impl === null) return false;

            param = adaptImmediateToDiffNumFormats(param);
            //message("checkRel param is '" + param + "'");
            var match_data = param.match(/^([.a-zA-z0-9_$]+)$/i);
            if (match_data) {
                var addr = labels.find(match_data[1]);
                if (addr) {
                    if(displayMsg)
                        message("Label '" + match_data[1] + "' has address " + hex32(addr));

                    var disp = (addr - (assembler.getTextPC() + impl.length)) & 0xffffffff;
                    return impl.asm(disp);
                } else if (assembler.getPass() === 1) {
                    return impl.asm(0);
                } else {
                    if(displayMsg)
                        asmmsg("Label '" + match_data[1] + "' not found.");
                    return null;
                }
            }
            // Label not seen.  Try [PC, #imm]
            match_data = param.match(/^\[\s*pc\s*,\s*#(-?[0-9]+)\s*]$/);
            if (match_data) {
                var disp = parseInt(match_data[1],0);
                if(displayMsg)
                    message("Immediate relative " + disp);
                return impl.asm(disp);
            }
            return null;
        }

        function checkRegRel(param, impl, codeArr, symbols, displayMsg) {
            if (impl === null) return false;

            param = adaptImmediateToDiffNumFormats(param);
            //message("checkRegRel param is '" + param + "'");
            var match_data = param.match(/^(r[0-9]+|pc|sp|lr)\s*,\s*[.a-zA-z0-9_]+$/i);
            if (match_data) {
                var rd = parsereg(match_data[1]);
                var addr = labels.find(match_data[2]);
                if (addr) {
                    if(displayMsg)
                        message("Label '" + match_data[1] + "' has address " + hex32(addr));

                    var disp = (addr - (assembler.getTextPC() + impl.length)) & 0xffffffff;
                    return impl.asm(rd, disp);
                } else if (assembler.getPass() === 1) {
                    return impl.asm(rd, 0);
                } else {
                    if(displayMsg)
                        asmmsg("Label '" + match_data[2] + "' not found.");

                    return null;
                }
            }
            match_data = param.match(/^(r[0-9]+|pc|sp|lr)\s*,\s*#([0-9]+)$/i);
            if (match_data) {
                var rd = parsereg(match_data[1]);
                var disp = parseInt(match_data[2],0);
                if(displayMsg)
                    message("Immediate relative " + disp);

                return impl.asm(rd, disp);
            }
            return null;
        }

        function checkI(param, impl, codeArr, symbols) {
            if (impl === null) return false;

            param = adaptImmediateToDiffNumFormats(param);
            //message("checkI param is '" + param + "'");
            var match_data = param.match(/^#[0-9]+$/i);
            if (match_data) {
                param = param.replace(/^.*#/,"");
                var imm = parseInt(param,10);
                return impl.asm(imm);
            }
            return null;
        }

        function checkNone(param, impl, codeArr, symbols) {
            if (impl === null) return false;
            if (param !== "")
                return null;
            return impl.asm();
        }

        // This is for BX
        function checkR(param, impl, codeArr, symbols) {
            if (impl === null) return false;

            param = adaptImmediateToDiffNumFormats(param);
            //message("checkI param is '" + param + "'");
            var match_data = param.match(/^(r[0-9]+|pc|sp|lr)\s*/);
            if (match_data) {
                var rd = parsereg(match_data[1]);
                return impl.asm(rd);
            }
            return null;
        }

        var REGLIST = 1;
        var OP_1N1I = 2;
        var OP_1N2 = 3;
        var OP1I = 4;
        var OP2I = 5;
        var OP3 = 6;
        var OP2 = 7;
        var OP_REL = 8;
        var OP_1REL = 9;
        var OP_I = 10;
        var OP_NONE = 11;
        var Opcodes = [
            //        RL   1N1I    1N2     RI   RRI   RRR   RR   Rel   1Rel  Imm  None checkR
            ["ADCS",  null,null,   null,  null, null, null,ADC2, null, null, null,null, null],
            ["ADDS",  null,null,   null, ADD1I, ADD2I,ADD3,ADDS2,null, null, null,null, null],
            ["ADD",   null,null,   null,ADD_SI,ADD_RSI,null,ADD2,null, null, null,null, null],
            ["ANDS",  null,null,   null,  null, null, AND3,AND2, null, null, null,null, null],
            ["ASRS",  null,null,   null,  null, ASR2I,null,ASR2, null, null, null,null, null],
            ["BL",    null,null,   null,  null, null, null,null, BL  , null, null,null, null],
            ["B",     null,null,   null,  null, null, null,null, B,    null, null,null, null],
            ["BEQ",   null,null,   null,  null, null, null,null, BEQ,  null, null,null, null],
            ["BNE",   null,null,   null,  null, null, null,null, BNE,  null, null,null, null],
            ["BCS",   null,null,   null,  null, null, null,null, BCS,  null, null,null, null],
            ["BCC",   null,null,   null,  null, null, null,null, BCC,  null, null,null, null],
            ["BMI",   null,null,   null,  null, null, null,null, BMI,  null, null,null, null],
            ["BPL",   null,null,   null,  null, null, null,null, BPL,  null, null,null, null],
            ["BVS",   null,null,   null,  null, null, null,null, BVS,  null, null,null, null],
            ["BVC",   null,null,   null,  null, null, null,null, BVC,  null, null,null, null],
            ["BHI",   null,null,   null,  null, null, null,null, BHI,  null, null,null, null],
            ["BLS",   null,null,   null,  null, null, null,null, BLS,  null, null,null, null],
            ["BGE",   null,null,   null,  null, null, null,null, BGE,  null, null,null, null],
            ["BLT",   null,null,   null,  null, null, null,null, BLT,  null, null,null, null],
            ["BGT",   null,null,   null,  null, null, null,null, BGT,  null, null,null, null],
            ["BLE",   null,null,   null,  null, null, null,null, BLE,  null, null,null, null],
            ["BAL",   null,null,   null,  null, null, null,null, B,    null, null,null, null],
            ["BX",    null,null,   null,  null, null, null,null, null, null, null,null, BX],
            ["BICS",  null,null,   null,  null, null, null,BIC2, null, null, null,null, null],
            ["CMN",   null,null,   null,  null, null, null,CMN2, null, null, null,null, null],
            ["CMP",   null,null,   null,  CMP1I,null, null,CMP2, null, null, null,null, null],
            ["BKPT",  null,null,   null,  null, null, null,null, null, null, BKPTI,BKPT, null],
            ["CPSID", null,null,   null,  null, null, null,null, null, null, null,CPSID, null],
            ["CPSIE", null,null,   null,  null, null, null,null, null, null, null,CPSIE, null],
            ["EORS",  null,null,   null,  null, null, EOR3,EOR2, null, null, null,null, null],
            ["LDR",   null,LDRI,   LDR3,  null, null, null,null, null, LDRL, null,null, null],
            ["LDRB",  null,LDRBI,  LDRB3, null, null, null,null, null, null, null,null, null],
            ["LDRH",  null,LDRHI,  LDRH3, null, null, null,null, null, null, null,null, null],
            ["LDRSB", null,null,   LDRSB3,null, null, null,null, null, null, null,null, null],
            ["LDRSH", null,null,   LDRSH3,null, null, null,null, null, null, null,null, null],
            ["LSLS",  null,null,   null,  null, LSL2I,null,LSL2, null, null, null,null, null],
            ["LSRS",  null,null,   null,  null, LSR2I,null,LSR2, null, null, null,null, null],
            ["MOVS",  null,null,   null,  MOV1I,null, null,MOV2, null, null, null,null, null],
            ["MOV",   null,null,   null,  null ,null, null,MOV3, null, null, null,null, null],
            ["MULS",  null,null,   null,  null, null, null,MUL2, null, null, null,null, null],
            ["MVNS",  null,null,   null,  null, null, null,MVN2, null, null, null,null, null],
            ["NEGS",  null,null,   null,  null, null, null,NEG2, null, null, null,null, null],
            ["NOP",   null,null,   null,  null, null, null,null, null, null, null,NOP,  null],
            ["ORRS",  null,null,   null,  null, null, ORR3,ORR2, null, null, null,null, null],
            ["POP",   POP, null,   null,  null, null, null,null, null, null, null,null, null],
            ["PUSH",  PUSH,null,   null,  null, null, null,null, null, null, null,null, null],
            ["REV",   null,null,   null,  null, null, null,REV,  null, null, null,null, null],
            ["REV16", null,null,   null,  null, null, null,REV16,null, null, null,null, null],
            ["REVSH", null,null,   null,  null, null, null,REVSH,null, null, null,null, null],
            ["RORS",  null,null,   null,  null, null, null,ROR2, null, null, null,null, null],
            ["RSBS",  null,null,   null,  null, RSB2I,null,null, null, null, null,null, null],
            ["SBCS",  null,null,   null,  null, null, null,SBC2, null, null, null,null, null],
            ["SEV",   null,null,   null,  null, null, null,null, null, null, null,SEV,  null],
            ["SUB",   null,null,   null, SUB_SI,SUBSSI,null,null, null, null, null,null, null],
            ["SUBS",  null,null,   null,  SUB1I,SUB2I,SUB3,SUBS2,null, null, null,null, null],
            ["STR",   null,STRI,   STR3,  null, null, null,null, null, null, null,null, null],
            ["STRB",  null,STRBI,  STRB3, null, null, null,null, null, null, null,null, null],
            ["STRH",  null,STRHI,  STRH3, null, null, null,null, null, null, null,null, null],
            ["SXTB", null,null,   null,  null, null, null,SXTB, null, null, null,null, null],
            ["SXTH", null,null,   null,  null, null, null,SXTH, null, null, null,null, null],
            ["UXTB", null,null,   null,  null, null, null,UXTB, null, null, null,null, null],
            ["UXTH", null,null,   null,  null, null, null,UXTH, null, null, null,null, null],
            ["TST",  null,null,   null,  null, null, null,TST2, null, null, null,null, null],
            ["WFE",  null,null,   null,  null, null, null,null, null, null, null,WFE,  null],
            ["WFI",  null,null,   null,  null, null, null,null, null, null, null,WFI,  null],
            ["YIELD",null,null,   null,  null, null, null,null, null, null, null,YIELD,null],
        ];
        var Types = [
            0,
            checkReglist,
            check1N1I,
            check1N2,
            checkRI,
            checkRRI,
            checkRRR,
            checkRR,
            checkRel,
            checkRegRel,
            checkI,
            checkNone,
            checkR,
        ];

        // TODO: remove codeArr
        function encode(command, param, codeArr, symbols, displayMsg) {
            var code = null;
            for (var o = 0; o < Opcodes.length; o += 1) {
                //message("Trying to match '" + command + "' against '" + Opcodes[o][0] + "'");
                if (Opcodes[o][0] === command) {

                    for (var t=1; t < Types.length; t += 1) {
                        var check = Types[t];
                        if (Opcodes[o][t] === null)
                            continue;
                        code = check(param,Opcodes[o][t],codeArr,symbols, displayMsg);
                        if (code !== null)
                            break;
                    }
                    if (code === null)
                        asmmsg("Bad arguments");
                    break;
                }
            }

            return code;
        }

        return {
            decode: decode,
            encode: encode
        };
    }

    function UI() {
        var currentState;

        var start = {
            assemble: true,
            run: [false, 'Run'],
            reset: false,
            hexdump: false,
            disassemble: false,
            debug: false
        };
        var assembled = {
            assemble: false,
            run: [true, 'Run'],
            reset: true,
            hexdump: true,
            disassemble: true,
            debug: true
        };
        var running = {
            assemble: false,
            run: [true, 'Stop'],
            reset: true,
            hexdump: false,
            disassemble: false,
            debug: false
        };
        var debugging = {
            assemble: false,
            run: [true, 'Stop'],
            reset: true,
            hexdump: true,
            disassemble: true,
            debug: true
        };
        var postDebugging = {
            assemble: false,
            reset: true,
            hexdump: true,
            disassemble: true,
            debug: true
        };


        function setState(state) {
            $node.find('.assembleButton').attr('disabled', !state.assemble);
            if (state.run) {
                $node.find('.runButton').attr('disabled', !state.run[0]);
                $node.find('.runButton').val(state.run[1]);
            }
            $node.find('.resetButton').attr('disabled', !state.reset);
            $node.find('.hexdumpButton').attr('disabled', !state.hexdump);
            $node.find('.disassembleButton').attr('disabled', !state.disassemble);
            $node.find('.stepButton').attr('disabled', !state.debug);
            $node.find('.gotoButton').attr('disabled', !state.debug);
            currentState = state;
        }

        function initialize() {
            setState(start);
        }

        function play() {
            setState(running);
        }

        function stop() {
            setState(assembled);
        }

        function debugOn() {
            setState(debugging);
        }

        function debugOff() {
            setState(postDebugging);
        }

        function assembleSuccess() {
            setState(assembled);
        }

        function toggleMonitor() {
            $node.find('.monitor').toggle();
        }

        function showNotes() {
            $node.find('.messages code').html($node.find('.notes').html());
        }

        function captureTabInEditor(e) {
            // Tab Key
            if(e.keyCode === 9) {

                // Prevent focus loss
                e.preventDefault();

                // Insert tab at caret position (instead of losing focus)
                var caretStart = this.selectionStart,
                    caretEnd   = this.selectionEnd,
                    currentValue = this.value;

                this.value = currentValue.substring(0, caretStart) + "\t" + currentValue.substring(caretEnd);

                // Move cursor forwards one (after tab)
                this.selectionStart = this.selectionEnd = caretStart + 1;
            }
        }

        return {
            initialize: initialize,
            play: play,
            stop: stop,
            assembleSuccess: assembleSuccess,
            debugOn: debugOn,
            debugOff: debugOff,
            toggleMonitor: toggleMonitor,
            showNotes: showNotes,
            captureTabInEditor: captureTabInEditor
        };
    }


    function Display() {
        var displayArray = [];
        var palette = [
            "#000000", "#ffffff", "#880000", "#aaffee",
            "#cc44cc", "#00cc55", "#0000aa", "#eeee77",
            "#dd8855", "#664400", "#ff7777", "#333333",
            "#777777", "#aaff66", "#0088ff", "#bbbbbb"
        ];
        var ctx;
        var width;
        var height;
        var pixelSize;
        var numX = 32;
        var numY = 32;

        function initialize() {
            /*var canvas = $node.find('.screen')[0];
            width = canvas.width;
            height = canvas.height;
            pixelSize = width / numX;
            ctx = canvas.getContext('2d');
            reset();*/
        }

        function reset() {
            if(range != null) {
                ace.edit("editor").session.removeMarker(range.id);
            }

            if(rangeStartup != null) {
                ace.edit("startup-editor").session.removeMarker(rangeStartup.id);
            }

            //ctx.fillStyle = "black";
            //ctx.fillRect(0, 0, width, height);
        }

        function updatePixel(addr) {
            /*ctx.fillStyle = palette[memory.peek8(addr) & 0x0f];
            var y = Math.floor((addr & 0xfff) / 32);
            var x = (addr & 0xfff) % 32;
            ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);*/
        }

        return {
            initialize: initialize,
            reset: reset,
            updatePixel: updatePixel
        };
    }

    function Memory() {
        var ROM_START = 0x08000000;
        var ROM_END =  ROM_START + 32768; // 32KB of onboard Flash
        var SRAM_START = 0x20000000;
        var SRAM_END = SRAM_START + 8192;

        // STM32 F0 Peripheral address map
        var IO_START = 0x40000000;
        var IO_END = 0x48001800;

        var rom = new Array(32768);
        var sram = new Array(8192);
        var io = new Array(4096);

        // To keep track of recent writes to the location
        // cleared when UI memory monitor updates
        var recentWrite = new Array(8192);

        function setMemoryChanged8(addr) {
            recentWrite[addr] = 1;
        }

        function setMemoryChanged16(addr) {
            for (var i = 1; i >= 0; i--) {
                setMemoryChanged8(addr + i);
            }
        }

        function setMemoryChanged32(addr) {
            for (var i = 3; i >= 0; i--) {
                setMemoryChanged8(addr + i);
            }
        }

        function clearMemoryChanged8(addr) {
            recentWrite[addr] = 0;
        }

        function clearMemoryChanged32(addr) {
            for (var i = 3; i >= 0; i--) {
                clearMemoryChanged8(addr + i);
            }
        }

        function changed8(addr) {
            return recentWrite[addr - SRAM_START];
        }

        function clearChanged8(addr) {
            clearMemoryChanged8(addr - SRAM_START);
        }

        function clear_sram() {
            for (var i = SRAM_START; i < SRAM_END; i+=4) {
                memory.poke32(i, 0x00);
                clearMemoryChanged32(i - SRAM_START);
            }
        }

        function ioread8(addr) {
            var offset = addr & 0xfff;
            return io[offset] & 0xff;
        }

        function iowrite8(addr, value) {
            var offset = addr & 0xfff;
            io[offset] = value & 0xff;
            if (offset < 1024)
                display.updatePixel(addr);
        }

        function read8(addr) {
            if (addr >= ROM_START && addr < ROM_END)
                return rom[addr - ROM_START];
            else if (addr >= SRAM_START && addr < SRAM_END)
                return sram[addr - SRAM_START];
            else if (addr >= IO_START && addr < IO_END)
                return io[addr - IO_START];
            simulator.hardfault(addr, 0);
            return null;
        }

        function read16(addr) {
            if (addr & 1) {
                simulator.hardfault(addr,2);
                return null;
            }
            if (addr >= ROM_START && addr < ROM_END)
                return rom[addr-ROM_START] + (rom[addr-ROM_START+1] << 8);
            else if (addr >= SRAM_START && addr < SRAM_END)
                return sram[addr-SRAM_START] + (sram[addr-SRAM_START+1] << 8);
            else if (addr >= IO_START && addr < IO_END)
                return io[addr-IO_START] + (io[addr-IO_START+1] << 8);
            simulator.hardfault(addr, 0);
            return null;
        }

        function read32(addr) {
            if (addr & 3) {
                simulator.hardfault(addr,4);
                return null;
            }
            if (addr >= ROM_START && addr < ROM_END)
                return rom[addr-ROM_START] + (rom[addr-ROM_START+1] << 8)
                + (rom[addr-ROM_START+2] << 16) + (rom[addr-ROM_START+3] << 24);
            else if (addr >= SRAM_START && addr < SRAM_END)
                return sram[addr-SRAM_START] + (sram[addr-SRAM_START+1] << 8)
                + (sram[addr-SRAM_START+2] << 16) + (sram[addr-SRAM_START+3] << 24);
            else if (addr >= IO_START && addr < IO_END)
                return io[addr-IO_START] + (io[addr-IO_START+1] << 8)
                + (io[addr-IO_START+2] << 16) + (io[addr-IO_START+3] << 24);
            simulator.hardfault(addr, 0);
            return null;
        }

        function peek8(addr) {
            if (addr >= ROM_START && addr < ROM_END)
                return rom[addr - ROM_START];
            else if (addr >= SRAM_START && addr < SRAM_END)
                return sram[addr - SRAM_START];
            else if (addr >= IO_START && addr < IO_END)
                return io[addr - IO_START];
            return 0;
        }

        function peek16(addr) {
            if (addr >= ROM_START && addr < ROM_END)
                return rom[addr-ROM_START] + (rom[addr-ROM_START+1] << 8);
            else if (addr >= SRAM_START && addr < SRAM_END)
                return sram[addr-SRAM_START] + (sram[addr-SRAM_START+1] << 8);
            else if (addr >= IO_START && addr < IO_END)
                return io[addr-IO_START] + (io[addr-IO_START+1] << 8);
            return 0;
        }

        function peek32(addr) {
            if (addr >= ROM_START && addr < ROM_END)
                return rom[addr-ROM_START] + (rom[addr-ROM_START+1] << 8)
                + (rom[addr-ROM_START+2] << 16) + (rom[addr-ROM_START+3] << 24);
            else if (addr >= SRAM_START && addr < SRAM_END)
                return sram[addr-SRAM_START] + (sram[addr-SRAM_START+1] << 8)
                + (sram[addr-SRAM_START+2] << 16) + (sram[addr-SRAM_START+3] << 24);
            else if (addr >= IO_START && addr < IO_END)
                return io[addr-IO_START] + (io[addr-IO_START+1] << 8)
                + (io[addr-IO_START+2] << 16) + (io[addr-IO_START+3] << 24);
            return 0;
        }

        function write8(addr, value) {
            if (addr >= ROM_START && addr < ROM_END) {
                simulator.hardfault(addr, 0);
                return null;
            } else if (addr >= SRAM_START && addr < SRAM_END) {
                setMemoryChanged8(addr-SRAM_START);
                sram[addr-SRAM_START] = value & 0x00ff;
            }
            else if(addr >= IO_START && addr < IO_END)
                io[addr-IO_START] = value & 0x00ff;
            else {
                simulator.hardfault(addr, 0);
                return null;
            }
            return true;
        }

        function write16(addr, value) {
            if (addr & 1) {
                simulator.hardfault(addr, 2);
                return null;
            }
            if (addr >= ROM_START && addr < ROM_END) {
                simulator.hardfault(addr, 0);
                return null;
            } else if (addr >= SRAM_START && addr < SRAM_END) {
                setMemoryChanged16(addr-SRAM_START);
                sram[addr-SRAM_START] = value & 0x00ff;
                sram[addr-SRAM_START+1] = (value & 0xff00) >> 8;
            } else if (addr >= IO_START && addr < IO_END) {
                io[addr-IO_START] = value & 0x00ff;
                io[addr-IO_START+1] = (value & 0xff00) >> 8;
            } else {
                simulator.hardfault(addr, 0);
                return null;
            }
            return true;
        }

        function write32(addr, value) {
            if (addr & 3) {
                simulator.hardfault(addr, 4);
                return null;
            }
            if (addr >= ROM_START && addr < ROM_END) {
                simulator.hardfault(addr, 0);
                return null;
            } else if (addr >= SRAM_START && addr < SRAM_END) {
                setMemoryChanged32(addr-SRAM_START);
                sram[addr-SRAM_START] = value & 0x00ff;
                sram[addr-SRAM_START+1] = (value & 0xff00) >> 8;
                sram[addr-SRAM_START+2] = (value & 0xff0000) >> 16;
                sram[addr-SRAM_START+3] = (value & 0xff000000) >> 24;
            } else if (addr >= IO_START && addr < IO_END) {
                io[addr-IO_START] = value & 0x00ff;
                io[addr-IO_START+1] = (value & 0xff00) >> 8;
                io[addr-IO_START+2] = (value & 0xff0000) >> 16;
                io[addr-IO_START+3] = (value & 0xff000000) >> 24;
            } else {
                simulator.hardfault(addr, 0);
                return null;
            }
        }

        function poke8(addr, value) {
            if (addr >= ROM_START && addr < ROM_END)
                rom[addr-ROM_START] = value & 0x00ff;
            else if (addr >= SRAM_START && addr < SRAM_END) {
                setMemoryChanged8(addr-SRAM_START);
                sram[addr-SRAM_START] = value & 0x00ff;
            }
            else if(addr >= IO_START && addr < IO_END)
                io[addr-IO_START] = value & 0x00ff;
            else
                message("Unmapped poke8 at address " + hex32(addr));
        }

        function poke16(addr, value) {
            if (addr >= ROM_START && addr < ROM_END) {
                rom[addr-ROM_START] = value & 0x00ff;
                rom[addr-ROM_START+1] = (value & 0xff00) >> 8;
            } else if (addr >= SRAM_START && addr < SRAM_END) {
                setMemoryChanged16(addr-SRAM_START);
                sram[addr-SRAM_START] = value & 0x00ff;
                sram[addr-SRAM_START+1] = (value & 0xff00) >> 8;
            } else if (addr >= IO_START && addr < IO_END) {
                io[addr-IO_START] = value & 0x00ff;
                io[addr-IO_START+1] = (value & 0xff00) >> 8;
            } else
                message("Unmapped poke16 at address " + hex32(addr));
        }

        function poke32(addr, value) {
            if (addr >= ROM_START && addr < ROM_END) {
                rom[addr-ROM_START] = value & 0x00ff;
                rom[addr-ROM_START+1] = (value & 0xff00) >> 8;
                rom[addr-ROM_START+2] = (value & 0xff0000) >> 16;
                rom[addr-ROM_START+3] = (value & 0xff000000) >> 24;
            } else if (addr >= SRAM_START && addr < SRAM_END) {
                setMemoryChanged32(addr-SRAM_START);
                sram[addr-SRAM_START] = value & 0x00ff;
                sram[addr-SRAM_START+1] = (value & 0xff00) >> 8;
                sram[addr-SRAM_START+2] = (value & 0xff0000) >> 16;
                sram[addr-SRAM_START+3] = (value & 0xff000000) >> 24;
            } else if (addr >= IO_START && addr < IO_END) {
                io[addr-IO_START] = value & 0x00ff;
                io[addr-IO_START+1] = (value & 0xff00) >> 8;
                io[addr-IO_START+2] = (value & 0xff0000) >> 16;
                io[addr-IO_START+3] = (value & 0xff000000) >> 24;
            } else
                message("Unmapped poke32 at address " + hex32(addr));
        }

        // OLD:
        function set(addr, value) {
            return memArray[addr] = value;
        }

        // OLD:
        function get(addr) {
            return memArray[addr];
        }

        // OLD:
        function getWord(addr) {
            return get(addr) + (get(addr + 1) << 8);
        }

        // OLD:
        // Poke a byte, don't touch any registers
        function storeByte(addr, value) {
            set(addr, value & 0xff);
            if ((addr >= 0x20000000) && (addr <= 0x200005ff)) {
                display.updatePixel(addr);
            }
        }

        // Store keycode in 0xe0000000 + 1024
        function storeKeypress(e) {
            var value = e.which;
            //message("Storing key " + value.toString(10))
            //memory.poke8(0xe0000000 + 1024, value);
        }

        function format(start, length) {
            var html = '';
            var n;

            for (var x = 0; x < length; x++) {
                if ((x & 15) === 0) {
                    if (x > 0) { html += "\n"; }
                    n = (start + x);
                    html += num2hex(((n >> 8) & 0xff));
                    html += num2hex((n & 0xff));
                    html += ": ";
                }
                html += num2hex(memory.peek8(start + x));
                html += " ";
            }
            return html;
        }

        return {
            clear_sram: clear_sram,
            read8: read8,
            read16: read16,
            read32: read32,
            peek8: peek8,
            peek16: peek16,
            peek32: peek32,
            write8: write8,
            write16: write16,
            write32: write32,
            poke8: poke8,
            poke16: poke16,
            poke32: poke32,
            set: set,
            get: get,
            getWord: getWord,
            storeByte: storeByte,
            storeKeypress: storeKeypress,
            format: format,
            changed8: changed8,
            clearChanged8: clearChanged8
        };
    }

    //=========================================================================
    // The register file.
    //=========================================================================
    function Registers() {
        var gen = new Array(20);
        var ticks = 0;
        var nflag = 0;
        var zflag = 0;
        var cflag = 0;
        var vflag = 0;

        for(var i=0; i<20; i += 1)
            gen[i] = 0;
        gen[SP] = 0x100;

        function read(r) {
            if (r == APSR)
                return (nflag<<31) | (zflag<<30) | (cflag<<29) | (vflag<<28);
            return gen[r];
        }
        // Look at the register without treating as a read.
        function peek(r) {
            if (r == APSR)
                return (nflag<<31) | (zflag<<30) | (cflag<<29) | (vflag<<28);
            return gen[r];
        }
        function write(r, value) {
            if (r === SP)
                value &= 0xfffffffc;
            else
                value &= 0xffffffff;

            // Since ARMv6 supports only thumb mode set the T bit
            if (r == LR)
                value |= 0x1;

            if(r == PC)
                value &= ~(0x1);

            if (r === APSR) {
                nflag = (value>>31) & 1;
                zflag = (value>>30) & 1;
                cflag = (value>>29) & 1;
                vflag = (value>>28) & 1;
            } else
                gen[r] = value;
        }

        function poke(r, value) {
            if (r === SP)
                value &= 0xfffffffc;
            else
                value &= 0xffffffff;

            // Since ARMv6 supports only thumb mode set the T bit
            if (r == LR)
                value |= 0x1;

            if(r == PC)
                value &= ~(0x1);

            if (r === APSR) {
                nflag = (value>>31) & 1;
                zflag = (value>>30) & 1;
                cflag = (value>>29) & 1;
                vflag = (value>>28) & 1;
            } else
                gen[r] = value;
        }
        function tick() {
            ticks += 1;
        }
        function getticks() {
            return ticks;
        }
        function updateNZ(n,z) {
            if (n && (n!==0))
                nflag = 1;
            else
                nflag = 0;
            if (z && (z!==0))
                zflag = 1;
            else
                zflag = 0;
        }
        function updateNZC(n,z,c) {
            updateNZ(n,z);
            if (c && (c!==0))
                cflag = 1;
            else
                cflag = 0;
        }
        function updateNZCV(n,z,c,v) {
            updateNZC(n,z,c);
            if (v && (v!==0))
                vflag = 1;
            else
                vflag = 0;
        }
        function getc() {
            return cflag;
        }

        function getn() {
            return nflag;
        }

        function getv() {
            return vflag;
        }

        function getz() {
            return zflag;
        }

        function flagString() {
            return "" + nflag + zflag + cflag + vflag;
        }
        return {
            peek: peek,
            read: read,
            write: write,
            poke: poke,
            tick: tick,
            getticks: getticks,
            updateNZ: updateNZ,
            updateNZC: updateNZC,
            updateNZCV: updateNZCV,
            getc: getc,
            getn: getn,
            getv: getv,
            getz: getz,
            flagString: flagString
        }
    }

    //=========================================================================
    // Main body of the simulator.
    //=========================================================================
    function Simulator() {
        var codeRunning = false;
        var debug = false;
        var monitoring = false;
        var previosulyStopped = false;
        var executeId;
        var hitBreakpoint = false;

        // Currently hardcoded, needs to be filled by linker
        var interruptVectorTable = {
            "Reserved": 0x00000000,
            "Reset": 0x08000120,
            "NMI": 0x00000000,
            "HardFault": 0x00000000
        }

        // Fetch an instruction.  Increment the PC.
        function fetch() {
            var pc = reg.read(PC);
            var value = memory.read16( pc );
            if (value === null)
                return null;
            reg.write(PC, pc + 2);

            // Check for a 32-bit instruction encoding.
            if (((value & 0xe000) === 0xe000) && ((value & 0x1800) !== 0x0000)) {
                value |= (memory.read16( pc +  2) << 16);
                reg.write(PC, pc + 4);
            }

            // Check for a 32 bit inst
            if((value & 0xf000) == 0xf000) {
                value |= (memory.read16( pc + 2) << 16);
                reg.write(PC, pc + 4);
            }

            return value;
        }

        // Highlight the next instruction to be executed
        function highlightNextExecution() {
            var loc = reg.read(PC);
            var line = pc_line_map[loc];

            if(typeof line === 'undefined') {
                // This means we have not assembled the code so do not do anything
                return;
            }

            var editor = null;
            var fileRange = null;
            var tabNo = 0;

            var startupLength = ace.edit("startup-editor").session.getLength();
            if(line < startupLength) {
                activeFileName = "startup.s";
                editor = ace.edit("startup-editor");
                fileRange = rangeStartup;
                tabNo = 1;
            } else {
                activeFileName = "main.s";
                line = line - startupLength;
                editor = ace.edit("editor");
                fileRange = range;
                tabNo = 0;
            }

            updateTabToActiveEditor();

            var Range = ace.require('ace/range').Range;

            // Get rid of the existing marker if there is one 
            if(fileRange != null) {
                editor.session.removeMarker(fileRange.id);
            }

            var newRange = new Range(line, 0, line, 10);
            newRange.id = editor.session.addMarker(newRange, "ace_highlight-marker", "fullLine");

            if(tabNo == 1) {
                rangeStartup = newRange;
            } else {
                range = newRange;
            }
        }

        // Execute an instruction.
        function execute(debugging) {
            if (!codeRunning && !debugging) { return; }

            var editor = ace.edit("editor");
            var currentLine = pc_line_map[reg.read(PC)];
            var breakPoints = editor.session.getBreakpoints();
            var tabNo = -1;

            // Uncomment this section to show instruction trace during debug
            /*if (debugging){
                message(impl.dis(inst));
            }*/

            // Check is current line is a breakpoint
            // if so stop


            var startupLength = ace.edit("startup-editor").session.getLength();
            if(currentLine < startupLength) {
                activeFileName = "startup.s";
                editor = ace.edit("startup-editor");
                tabNo = 1;
            } else {
                activeFileName = "main.s";
                currentLine = currentLine - startupLength;
                editor = ace.edit("editor");
                tabNo = 0;
            }

            if((currentLine in breakPoints) && (!hitBreakpoint)) {
                hitBreakpoint = true;
                stop();
                message("Breakpoint at line " + (currentLine + 1));
                ui.stop();
                return;
            }


            var inst = fetch();
            if (inst === null)
                return;

            var impl = instrs.decode(inst);

            impl.exec(inst);

            // Reset flag after execution
            hitBreakpoint = false;

            if (!codeRunning && !debugging) {
                stop();
                message("Program stopped at PC " + hex32(reg.read(PC)));
                ui.stop();
            }
        }

        // Executes the assembled code
        function runBinary() {
            if (codeRunning) {
                // Switch OFF everything
                stop();
                ui.stop();
                message("Stopped");
            } else {
                ui.play();
                codeRunning = true;
                executeId = setInterval(multiExecute, 15);
            }
        }

        function multiExecute() {
            if (!debug) {
                // use a prime number of iterations to avoid aliasing effects

                for (var w = 0; w < 97; w++) {
                    execute();
                }
            }
            updateDebugInfo();
        }

        function setRandomByte() {
            memory.set(0xfe, Math.floor(Math.random() * 256));
        }

        function updateMonitor() {

            var start = parseInt($node.find('.start').val(), 16);
            var length = parseInt($node.find('.length').val(), 16);

            var end = start + length - 1;
            var mem_table = document.getElementById("memoryTable");
            var table_rows = mem_table.rows.length;
            var addr = start;

            // Note we start from 1 because we do not want to
            // update the first row/col now
            for(var tr = 0; tr < table_rows; tr++) {
                var row = mem_table.rows[tr];
                for(var tc = 16; tc >= 0; tc--) {
                    var cell = row.cells[16 - tc];
                    if(tc == 0) {
                        cell.innerHTML = "0x" + addr2hex(addr + tc);
                    } else {
                        cell.innerHTML = num2hex(memory.peek8(addr + tc - 1));
                        if(memory.changed8(addr + tc - 1)) {
                            cell.style.backgroundColor = "yellow";
                            memory.clearChanged8(addr + tc - 1);
                        } else {
                            cell.style.backgroundColor = "white";
                        }
                    }
                }

                addr += 16;
            }

            if (!isNaN(start) && !isNaN(length) && start >= 0 && length > 0) {

            } else {
                monitorNode.html('Cannot monitor this range. Valid ranges are between $0000 and $ffff, inclusive.');
            }
        }

        function handleMonitorRangeChange() {

            var start = parseInt($node.find('.start').val(), 16);
            var length = parseInt($node.find('.length').val(), 16);

            var end = start + length - 1;
            var mem_table = document.getElementById("memoryTable");
            var table_rows = Math.ceil(length / 16);
            var prev_size = mem_table.rows.length;
            var addr = start;

            for(var tr = prev_size  - 1; tr >= 0; tr--)
                mem_table.deleteRow(tr);

            // Note we start from 1 because we do not want to
            // update the first row/col now
            for(var tr = 0; tr < table_rows; tr++)
            {
                var row = mem_table.insertRow(tr);
                for(var tc = 16; tc >= 0; tc--) {
                    var cell = row.insertCell(16 - tc);
                    if(tc == 0) {
                        cell.innerHTML = "0x" + addr2hex(addr + tc);
                    } else {
                        cell.innerHTML = num2hex(memory.peek8(addr + tc - 1));
                    }
                }
                addr += 16;
            }
        }

        // Execute one instruction and print values
        function debugExec() {
            execute(true);
            updateDebugInfo();
        }

        function updateRegisterFile() {
            var reg_file = document.getElementById("register-file");
            var i;

            // We want to update from the second row because the first is the heading
            for(i = 1; i <= 16; i++) {
                var value_col = reg_file.rows[i].cells[1];
                value_col.innerHTML = "0x" + hex32(reg.peek(i-1));
            }

            // update the flags
            value_col = reg_file.rows[17].cells[1];
            value_col.innerHTML = "NZCV";

            value_col = reg_file.rows[18].cells[1];
            value_col.innerHTML = reg.flagString();
        }

        function updateDebugInfo() {
            updateRegisterFile();
            updateMonitor();
            highlightNextExecution();
        }

        // gotoAddr() - Set PC to address (or address of label)
        function gotoAddr() {
            var inp = prompt("Enter address or label", "");
            var addr = 0;
            if (inp === null)
                return;
            if (labels.find(inp)) {
                addr = labels.getPC(inp);
            } else {
                if (inp.match(/^0x[0-9a-f]{1,8}$/i)) {
                    inp = inp.replace(/^0x/, "");
                    addr = parseInt(inp, 16);
                } else if (inp.match(/^\$[0-9a-f]{1,8}$/i)) {
                    inp = inp.replace(/^\$/, "");
                    addr = parseInt(inp, 16);
                } else if (inp.match(/^[0-9a-f]{1,8}$/i)) {
                    addr = parseInt(inp, 16);
                }
            }
            if (addr === 0) {
                message("Unable to find/parse given address/label");
            } else {
                reg.write(PC, addr);
            }
            updateDebugInfo();
        }


        function stopDebugger() {
            debug = false;
        }

        function enableDebugger() {
            debug = true;
            if (codeRunning) {
                updateDebugInfo();
            }
        }

        function cpu_reset() {
            var r;
            for(r=0; r<=12; r++)
                reg.poke(r,0);
            reg.poke(SP, 0x20000000 + 8192);
            reg.poke(LR, 0xffffffff);
            var pc = labels.find("startup");
            if (pc)
                reg.poke(PC, pc);
            else {
                message("**Link error: symbol 'main' not found.");
                reg.poke(PC, 0xffffffff);
            }
            reg.updateNZCV(0,0,0,0);
            updateRegisterFile();
            updateMonitor();
        }

        // reset() - Reset CPU and memory.
        function reset() {
            cpu_reset();
            triggerInterrupt("Reset");
            display.reset();
            memory.clear_sram();
        }

        function stop() {
            codeRunning = false;
            clearInterval(executeId);
        }

        function toggleMonitor() {
            monitoring = !monitoring;
        }

        function hardfault(addr, mask) {
            // Back up the PC to the current instruction so that
            // execution cannot move on when the user presses "Step"
            // after hitting a hardfault.
            reg.write(PC, reg.read(PC) - 2);
            var text = "HardFault Exception:\n"
                + "\n"
                + "A HardFault exception occurred at PC "
                + hex32(reg.read(PC)) + "\n"
                + "because the memory operation for address "
                + hex32(addr) + "\n";
            if (mask === 0)
                text += "was not mapped.\n";
            else
                text += "was not aligned on a " + mask.toString(10)
                    + "-byte boundary.\n";
            alert(text);
            simulator.stop();
            ui.stop();
            return true;
        }

        function triggerInterrupt(source) {
            // Note this is a super simplified version of interrupt
            // This is NOT how it works! this is work in progress!
            var interruptVector = interruptVectorTable[source];
            reg.write(PC, interruptVector);
        }

        return {
            interruptVectorTable: interruptVectorTable,
            runBinary: runBinary,
            enableDebugger: enableDebugger,
            stopDebugger: stopDebugger,
            debugExec: debugExec,
            gotoAddr: gotoAddr,
            cpu_reset: cpu_reset,
            reset: reset,
            stop: stop,
            toggleMonitor: toggleMonitor,
            handleMonitorRangeChange: handleMonitorRangeChange,
            hardfault: hardfault,
            highlightNextExecution: highlightNextExecution
        };
    }


    function Labels() {
        var labelIndex = [];

        function indexLines(lines, symbols) {
            for (var i = 0; i < lines.length; i++) {
                if (!indexLine(lines[i], symbols)) {
                    message("**Label already defined at line " + (i + 1) + ":** " + lines[i]);
                    return false;
                }
            }
            return true;
        }

        // Extract label if line contains one and calculate position in memory.
        // Return false if label already exists.
        function indexLine(input, symbols) {

            var currentPC = assembler.getTextPC();
            assembler.assembleLine(input, 0, symbols); //TODO: find a better way for Labels to have access to assembler

            // Find command or label
            if (input.match(/^\w+:/)) {
                var label = input.replace(/(^\w+):.*$/, "$1");

                if (symbols.lookup(label)) {
                    message("**Label " + label + "is already used as a symbol; please rename one of them**");
                    return false;
                }

                return push(label + "|" + currentPC);
            }
            return true;
        }

        // Push label to array. Return false if label already exists.
        function push(name) {
            if (find(name)) {
                return false;
            }
            labelIndex.push(name + "|");
            return true;
        }

        // Returns number if label exists.
        function find(name) {
            var nameAndAddr;
            for (var i = 0; i < labelIndex.length; i++) {
                nameAndAddr = labelIndex[i].split("|");
                if (name === nameAndAddr[0]) {
                    return nameAndAddr[1];
                }
            }
            return false;
        }

        // Returns non-null symbol if label exists for addr.
        function findByAddr(addr) {
            var nameAndAddr;
            for (var i = 0; i < labelIndex.length; i++) {
                nameAndAddr = labelIndex[i].split("|");
                if (addr === nameAndAddr[1]) {
                    return nameAndAddr[0];
                }
            }
            return null;
        }

        // Associates label with address
        function setPC(name, addr) {
            var nameAndAddr;
            for (var i = 0; i < labelIndex.length; i++) {
                nameAndAddr = labelIndex[i].split("|");
                if (name === nameAndAddr[0]) {
                    labelIndex[i] = name + "|" + addr;
                    return true;
                }
            }
            return false;
        }

        // Get address associated with label
        function getPC(name) {
            var nameAndAddr;
            for (var i = 0; i < labelIndex.length; i++) {
                nameAndAddr = labelIndex[i].split("|");
                if (name === nameAndAddr[0]) {
                    return (nameAndAddr[1]);
                }
            }
            return -1;
        }

        function displayMessage() {
            var str = "Found " + labelIndex.length + " label";
            if (labelIndex.length !== 1) {
                str += "s";
            }
            message(str + ".");
        }

        function reset() {
            labelIndex = [];
        }

        return {
            indexLines: indexLines,
            find: find,
            findByAddr: findByAddr,
            getPC: getPC,
            displayMessage: displayMessage,
            reset: reset
        };
    }


    function Assembler() {
        var lineno = 0;
        var linetext = "";
        var textPC;
        var dataAddr;
        var codeArr;
        var dataArr;
        var equLookUp = {};
        var equArr = [];
        var codeAssembledOK = false;
        var wasOutOfRangeBranch = false;
        var pass = 0;
        var currCodeAddressKey = TEXT_START;
        var currDataAddressKey = DATA_START;

        // List of bools to check the lines of the file for
        // M0 instruction set;
        //    .cpu cortex-m0
        //    .thumb
        //    .syntax unified
        //    .fpu softvfp
        // Followed by .global main 
        var fiveLines = [false, false, false, false, false];

        // 0 denotes code/text and 1 denotes
        var assemble_section = 0;

        // Assembles the code into memory
        function assembleCode() {
            var BOOTSTRAP_ADDRESS = TEXT_START;

            // Used for the text region
            codeArr = {};
            codeArr[TEXT_START] = [];

            // Used for the data region
            dataArr = {};
            dataArr[DATA_START] = [];
            

            // Used by assembler for equ
            equArr = [];

            for (var i = 0; i < 5; i++) {
                fiveLines[i] = false;
            }

            wasOutOfRangeBranch = false;
            assemble_section = 0;
            labels.reset();
            textPC = TEXT_START;
            dataAddr = DATA_START;
            $node.find('.messages code').empty();

            var code = ace.edit("startup-editor").getValue() + "\n" + ace.edit("editor").getValue();
            code += "\n\n";
            var lines = code.split("\n");
            codeAssembledOK = true;

            pass = 0;
            message("Preprocessing ...");
            var symbols = preprocess(lines);

            pass = 1;
            message("Indexing labels ...");
            textPC = TEXT_START;
            if (!labels.indexLines(lines, symbols)) {
                return false;
            }

            labels.displayMessage();

            pass = 2;

            var maxKey = -1;
            for (const [key, value] of Object.entries(codeArr)) {
                if(key > maxKey)
                    maxKey = key
            }

            // codeArr has one byte per element
            var equAddr = parseInt(maxKey) + codeArr[maxKey].length;

            // Align the save location to 4 byte boundary
            if(equAddr % 4 != 0) {
                equAddr = (equAddr + 4) - ( (equAddr) % 4);
            }

            var equAddrStart = equAddr;
            textPC = TEXT_START;
            assemble_section = 0;
            codeArr = {};
            codeArr[TEXT_START] = [];
            message("Indexing .equ symbols...");

            // Replace the labels of the .equ with the offsets
            for(var lineno = 0; lineno < lines.length; lineno++) {

                // Check if we can assemble the line
                if(assembleLine(lines[lineno], lineno, symbols)) {

                    for(var key in equLookUp) {
                        var label_match = lines[lineno].match(key);
                        var absolute_val = false;
                        var address_match = null;

                        if(label_match != null) {
                            
                            // There is a .equ definition
                            var line = lines[lineno].replace(key, "%")
                            var address_match = line.match(/=%$/);
                        } 

                        if(address_match != null) {
                            // We have to do this because load aligns the PC to
                            // a four byte boundary
                            if(textPC % 4 == 0) {
                                var offset = equAddr - textPC + 2;
                            } else {
                                var offset = equAddr - textPC - 2;
                            }

                            // Notice difference equAddr vs equArr
                            equArr.push(equLookUp[key] & 0xff);
                            equArr.push((equLookUp[key] >> 8) & 0xff);
                            equArr.push((equLookUp[key] >> 16) & 0xff);
                            equArr.push((equLookUp[key] >> 24) & 0xff);

                            equAddr += 4;
                            lines[lineno] = lines[lineno].replace("="+key, "[pc,#" + offset.toString(10) + "]");
                            break;
                        }
                    }

                    if(lines[lineno].match(/=(.+)/)) {
                        absolute_val = false; 
                        // now we are looking for a value like = 512;
                        var dec_val = lines[lineno].match(/=(\d+)/);

                        if(dec_val != null) {
                           key = dec_val[1];
                           equLookUp[key] = parseInt(key);
                           absolute_val = true;
                        }

                        // now we are looking for a value like =0x---
                        var hex_val = lines[lineno].match(/=(0[xX]([0-9a-fA-F]+))/);
                        if(hex_val != null) {
                           key = hex_val[1];
                           equLookUp[key] = parseInt(key);
                           absolute_val = true;
                        }

                        //now we are looking for a value like =0b---
                        var bin_val = lines[lineno].match(/=(0[bB]([0-1]+))/);
                        if(bin_val != null) {
                           key = bin_val[1];
                           equLookUp[key] = parseInt(bin_val[2], 2);
                           absolute_val = true;
                        }

                        if(absolute_val) {
                            // We have to do this because load aligns the PC to
                            // a four byte boundary
                            if(textPC % 4 == 0) {
                                var offset = equAddr - textPC + 2;
                            } else {
                                var offset = equAddr - textPC - 2;
                            }

                            // Notice difference equAddr vs equArr
                            equArr.push(equLookUp[key] & 0xff);
                            equArr.push((equLookUp[key] >> 8) & 0xff);
                            equArr.push((equLookUp[key] >> 16) & 0xff);
                            equArr.push((equLookUp[key] >> 24) & 0xff);

                            equAddr += 4;
                            lines[lineno] = lines[lineno].replace("="+key, "[pc,#" + offset.toString(10) + "]");
                        }
                    }

                    // Check for = val where val is the label form
                    // either code or data section
                    if(lines[lineno].match(/=(\w+)/)) {
                        // check if we have a label with that name
                        // if so then we can use that
                        var match = lines[lineno].match(/=(\w+)/);
                        if(labels.find(match[1])) {
                            var replace_label = true;
                            var addr = labels.find(match[1]);

                            // This is a hack ideally will have antoher array for this
                            // but this is just one person doing this
                            // will deal with this if we ever get a team
                            if(textPC % 4 == 0) {
                                var offset = equAddr - textPC + 2;
                            } else {
                                var offset = equAddr - textPC - 2;
                            }

                            // Notice difference equAddr vs equArr
                            equArr.push(addr & 0xff);
                            equArr.push((addr >> 8) & 0xff);
                            equArr.push((addr >> 16) & 0xff);
                            equArr.push((addr >> 24) & 0xff);

                            equAddr += 4;
                            lines[lineno] = lines[lineno].replace("="+match[1], "[pc,#" + offset.toString(10) + "]");
                        }
                    }

                    if(lines[lineno].match(/,\s*(\w+)/)) {
                        // check if we have a label with that name
                        // if so then we can use that
                        var match = lines[lineno].match(/,\s*(\w+)/);
                        if(labels.find(match[1])) {
                            var replace_label = true;
                            var addr = labels.find(match[1]);

                            // This is a hack ideally will have antoher array for this
                            // but this is just one person doing this
                            // will deal with this if we ever get a team
                            if(textPC % 4 == 0) {
                                var offset = addr - textPC + 2;
                            } else {
                                var offset = addr - textPC - 2;
                            }

                            lines[lineno] = lines[lineno].replace(match[1], "[pc,#" + offset.toString(10) + "]");
                        }
                    }

                } else {
                    codeAssembledOK = false;
                    break;
                }
            }

            pass = 3;
            textPC = TEXT_START;
            dataAddr = DATA_START;
            message("Assembling code ...");

            assemble_section = 0;
            codeArr = {};
            codeArr[TEXT_START] = [];
            dataArr = {};
            dataArr[DATA_START] = [];

            for (var i = 0; i < lines.length; i++) {
                lineno = i+1;

                if (!assembleLine(lines[i], i, symbols)) {
                    codeAssembledOK = false;
                    break;
                }
            }

            var codeLength = 0;
            for (const [key, value] of Object.entries(codeArr)) {
                codeLength += value.length;
            }

            if (codeLength === 0) {
                codeAssembledOK = false;
                message("No code to run.");
            }

            if (codeAssembledOK) {
                ace.edit("editor").session.clearAnnotations();
                ui.assembleSuccess();
            } else {
                var str = lines[i].replace("<", "&lt;").replace(">", "&gt;");
                var errorLine = i - ace.edit("startup-editor").session.getLength();
                if(!wasOutOfRangeBranch) {
                    message("**Syntax error line " + (errorLine + 1) + ": " + str + "**");
                } else {
                    message('**Out of range branch on line ' + (errorLine + 1) + ' (branches are limited to -128 to +127): ' + str + '**');
                }

                ace.edit("editor").getSession().setAnnotations([{
                  row: errorLine,
                  column: 0,
                  text: "Syntax error", // Or the Json reply from the parser 
                  type: "error" // also "warning" and "information"
                }]);
                ui.initialize();
                return false;
            }

            for (const [address, code] of Object.entries(codeArr)) {
                textPC = parseInt(address);
                for(var i=0; i < code.length; i += 1) {
                    memory.poke8(textPC, code[i]);
                    textPC += 1;
                }
            }

            while(textPC < equAddrStart) {
                textPC += 1;
                memory.poke8(textPC, 0);
            }

            for(var i = 0; i < equArr.length; i++) {
                memory.poke8(textPC, equArr[i]);
                textPC += 1;
            }

            for (const [address, data] of Object.entries(dataArr)) {
                dataAddr = parseInt(address);
                for(var i=0; i < data.length; i += 1) {
                    memory.poke8(dataAddr, data[i]);
                    dataAddr += 1;
                }
            }

            if(fiveLines[0] && fiveLines[1] && fiveLines[2] && fiveLines[3] && fiveLines[4]) {
                message("Code assembled successfully, " + codeLength + " bytes.");
                return true;
            } else {
                if(!fiveLines[0]) {
                    message("Error: CPU type not specified");
                }

                if(!fiveLines[1]) {
                    message("Error: Instruction set not specified");
                }

                if(!fiveLines[2]) {
                    message("Error: Syntax format not specified");
                }

                if(!fiveLines[3]) {
                    message("Error: FPU type not specified");
                }

                if(!fiveLines[4]) {
                    message("Error: Undefined reference to \"main\"");
                }

                return true;
            }
        }

        // Sanitize input: remove comments and trim leading/trailing whitespace
        function sanitize(line) {
            // remove comments
            var no_comments = line.replace(/^(.*?);.*/, "$1");
            no_comments = no_comments.replace(/^(.*?)\/\/.*/, "$1");

            // trim line
            return no_comments.replace(/^\s+/, "").replace(/\s+$/, "");
        }

        function preprocess(lines) {
            var table = [];
            var PREFIX = "__"; // Using a prefix avoids clobbering any predefined properties

            function lookup(key) {
                if (table.hasOwnProperty(PREFIX + key)) return table[PREFIX + key];
                else return undefined;
            }

            function add(key, value) {
                var valueAlreadyExists = table.hasOwnProperty(PREFIX + key)
                if (!valueAlreadyExists) {
                    table[PREFIX + key] = value;
                }
            }

            // Build the substitution table
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];

                // Look for the four lines of the cpu code
                var match = line.match(/\s*.cpu\s+cortex-m0\s?/);
                var match1 = line.match(/\s*.thumb/);
                var match2 = line.match(/\s*.syntax\s+unified\s?/);
                var match3 = line.match(/\s*.fpu\s+softvfp\s?/);
                var match4 = line.match(/\s*.global\s+main\s?/);

                if(match != null) {
                    fiveLines[0] = true;
                    lines[i] = "\n";
                }

                if(match1 != null) {
                    fiveLines[1] = true;
                    lines[i] = "\n";
                }

                if(match2 != null) {
                    fiveLines[2] = true;
                    lines[i] = "\n";
                }

                if(match3 != null) {
                    fiveLines[3] = true;
                    lines[i] = "\n";
                }

                if(match4 != null) {
                    fiveLines[4] = true;
                    lines[i] = "\n";
                }

                lines[i] = sanitize(lines[i]);
                //var match_data = lines[i].match(/^define\s+(\w+)\s+(\S+)/);
                var match_data = lines[i].match(/^(\w+)\s*=\s*(0x[0-9a-f]+|0[0-7]+|[0-9]+)/i);
                if (match_data) {
                    //message("Defined " + match_data[1] + " = '" + match_data[2] + "'");
                    add(match_data[1], sanitize(match_data[2]));
                    lines[i] = ""; // We're done with this preprocessor directive, so delete it
                }
            }

            // Callers will only need the lookup function
            return {
                lookup: lookup
            }
        }

        function parseExpression(param) {
            var expressionTree = {};
            var operands = [];
            var operators = [];
            var paramBuf = param;
            var match;
            var regHex = /0[xX][0-9a-fA-F]+/gi;
            var regDec = /[0-9]+/gi;
            var tempParam = param;
            do {
                match = regHex.exec(tempParam);
                if(match != null) {
                    operands.push(parseInt(match[0], 16));
                    tempParam = tempParam.replace(match[0], "");
                } else {
                    // If hex match is null try decimal
                    match = regDec.exec(tempParam);

                    if(match != null) {
                        operands.push(parseInt(match[0], 10));
                        tempParam = tempParam.replace(match[0], "");
                    }
                }

            } while(match);

            var reg = /\+|\-|\*/gi;
            do {
                match = reg.exec(param);
                if(match != null)
                    operators.push(match[0]);
            
            } while(match);

            var currentRes = operands.shift();
            for (var i = operators.length - 1; i >= 0; i--) {
                var operator = operators.shift();
                var operand = operands.shift();

                switch(operator) {
                    case "+":
                        currentRes += operand;
                        break;
                    case "-":
                        currentRes -= operand;
                        break;
                    case "*":
                        currentRes *= operand;
                        break;
                }
            }

            if(typeof currentRes == "undefined") {
                return param;
            }

            return currentRes;
        }

        function adaptImmediateToDiffNumFormats(param) {
            var parsedValue = String(parseExpression(param));
            return parsedValue;
        }

        // Assembles one line of code.
        // Returns true if it assembled successfully, false otherwise.
        function assembleLine(input, lineno, symbols) {
            var label, command, param, addr;

            // Find command or label
            if (input.match(/^\w+:/)) {
                label = input.replace(/(^\w+):.*$/, "$1");

                // Find label followed by inst or label
                if (input.match(/^\w+:[\s]*\w+.*$/)) {
                    input = input.replace(/^\w+:[\s]*(.*)$/, "$1");
                    command = input.replace(/^(\w+).*$/, "$1");
                } else if(input.match(/^\w+:[\s]*\.\w+.*$/)) {
                    // Find label followed by inst or label followed by .something
                    input = input.replace(/^\w+:[\s]*(.*)$/, "$1");
                    command = input.replace(/^(\.\w+).*$/, "$1");
                } else {
                    command = "";
                }
            } else if(input.match(/[\s+]?\.\w+.*$/)) {
                // Find .something
                input = input.replace(/[\s+](\.\w+.*$$)/, "$1");
                command = input.replace(/^(\.\w+).*$/, "$1");
            } else {
                command = input.replace(/^(\w+).*$/, "$1");
            }

            // Nothing to do for blank lines
            if (command === "") {
                return true;
            }

            command = command.toUpperCase();

            if (input.match(/^\w+\s+.*?$/)) {
                param = input.replace(/^\w+\s+(.*?)/, "$1");
            } else if (input.match(/^\.\w+\s+.*?$/)) {
                // .something value case
                param = input.replace(/^\.\w+\s+(.*?$)/, "$1");
            } else if (input.match(/^\w+$/) || input.match(/^\.\w+[\s+]?/)) {
                // also handle .data and .text
                param = "";
            } else {
                return false;
            }

            if (param.match(/^([rR][0-9]+)\s*,\s*=(\w+)/) || param.match(/^([rR][0-9]+)\s*,\s*(\w+)/)) {

                // During the final pass we should not find any "="
                if(pass < 3) {
                    // equ spotted
                    textPC += 2;

                    // push 2 bytes onto the code array
                    codeArr[currCodeAddressKey].push(0);
                    codeArr[currCodeAddressKey].push(0);
                    return true;
                }
            }

            var string = param;
            param = param.replace(/[ ]/g, "");

            if (command === "DCB") {
                return DCB(param);
            }

            var code = null;

            // Check for assembler directives
            if(command.match(/^\.\w+/))
            {
                command = command.replace(/^\.(\w+)/, '$1');
                switch(command) {
                    case "GLOBAL":
                                if (string.match(/^\s?\w+\s?$/))
                                        return true;
                                message("Specify a single label with .global");
                                return false;
                    case "DATA":
                                assemble_section = 1;
                                return true;
                    case "TEXT":
                                assemble_section = 0;
                                return true;
                    case "SPACE":
                                if(assemble_section == 0)
                                    pc_line_map[textPC] = lineno;

                                var i;
                                var space = adaptImmediateToDiffNumFormats(param);
                                for (i = 0; i < space; i++) {
                                  if(assemble_section) {
                                    dataAddr += 1;
                                    dataArr[currDataAddressKey].push(0);
                                  }
                                  else {
                                    textPC += 1;
                                    codeArr[currCodeAddressKey].push(0);
                                  }
                                }

                                return true;

                    case "BYTE" :
                                var num = adaptImmediateToDiffNumFormats(param);
                                if(num != null)
                                    param = num;
                                code = parseInt(param, 10);
                                if (code > 0xff) {
                                     message(".byte has a size limit of 255");
                                     return false;
                                }
                                if(assemble_section) {
                                    dataAddr += 1;
                                    dataArr[currDataAddressKey].push(code & 0xff);
                                } else {
                                    pc_line_map[textPC] = lineno;
                                    textPC += 1;
                                    codeArr[currCodeAddressKey].push(code & 0xff);
                                }
                                return true;

                    case "HWORD" :
                                var num = adaptImmediateToDiffNumFormats(param);
                                if(num != null)
                                    param = num;
                                code = parseInt(param, 10);
                                if (code > 0xffff) {
                                     message(".hword has a size limit of 0xffff");
                                     return false;
                                }
                                if(assemble_section) {
                                    dataAddr += 2;
                                    dataArr[currDataAddressKey].push(code & 0xff);
                                    dataArr[currDataAddressKey].push((code >> 8) & 0xff);
                                } else {
                                    pc_line_map[textPC] = lineno;
                                    textPC += 2;
                                    codeArr[currCodeAddressKey].push(code & 0xff);
                                    codeArr[currCodeAddressKey].push((code >> 8) & 0xff);
                                }
                                return true;

                    case "STRING" :
                                // replace quotes
                                string = string.replace(/['"]+/g, '');
                                if(assemble_section) {
                                    for(var i = 0; i < string.length; i++) {
                                        dataAddr += 1;

                                        if(string.charAt(i) == "\\") {
                                            i++;
                                            var byte = string.charAt(i);
                                            dataArr[currDataAddressKey].push(parseInt(byte));
                                            continue;
                                        }

                                        dataArr[currDataAddressKey].push(string.charCodeAt(i));
                                    }

                                    dataAddr += 1;

                                    // Push the null termination of the string
                                    dataArr[currDataAddressKey].push(0);
                                } else {
                                    pc_line_map[textPC] = lineno;
                                    for(var i = 0; i < string.length; i++) {
                                        textPC += 1;

                                        if(string.charAt(i) == "\\") {
                                            i++;
                                            var byte = string.charAt(i);
                                            codeArr[currCodeAddressKey].push(parseInt(byte));
                                            continue;
                                        }

                                        codeArr[currCodeAddressKey].push(string.charCodeAt(i));
                                    }

                                    textPC += 1;

                                    // Push the null termination of the string                                    
                                    codeArr[currCodeAddressKey].push(0);
                                }
                                return true;
                    case "WORD" :
                                var num = adaptImmediateToDiffNumFormats(param);
                                if(num != null)
                                    param = num;
                                code = parseInt(param, 10);
                                if (code > 0xffffffff) {
                                     message(".word has a size limit of 0xffffffff");
                                     return false;
                                }
                                if(assemble_section) {
                                    dataAddr += 4;
                                    dataArr[currDataAddressKey].push(code & 0xff);
                                    dataArr[currDataAddressKey].push((code >> 8) & 0xff);
                                    dataArr[currDataAddressKey].push((code >> 16) & 0xff);
                                    dataArr[currDataAddressKey].push((code >> 24) & 0xff);
                                } else {
                                    pc_line_map[textPC] = lineno;
                                    textPC += 4;
                                    codeArr[currCodeAddressKey].push(code & 0xff);
                                    codeArr[currCodeAddressKey].push((code >> 8) & 0xff);
                                    codeArr[currCodeAddressKey].push((code >> 16) & 0xff);
                                    codeArr[currCodeAddressKey].push((code >> 24) & 0xff);
                                }
                                return true;

                    case "ALIGN" :
                                var num = adaptImmediateToDiffNumFormats(param);
                                if(num != null)
                                    param = num;
                                code = parseInt(param, 10);
                                if(assemble_section) {
                                    while(dataAddr % code != 0) {
                                        dataAddr += 1;
                                        dataArr[currDataAddressKey].push(0);
                                    }
                                } else {
                                    while(textPC % code != 0) {
                                       codeArr[currCodeAddressKey].push(0);
                                       textPC += 1;
                                    }
                                }

                                return true;
                    case "EQU" :
                                param = adaptImmediateToDiffNumFormats(param);
                                param = param.replace(/\s+/,"");
                                var match = param.match(/(\w+)\,(\d+)$/);
                                if(match == null) {
                                	return false;
                                }
                                var label = match[1];
                                var value = parseInt(match[2]);
                                equLookUp[label] = value;
                                return true;

                    case "ORG" :
                                param = adaptImmediateToDiffNumFormats(param);
                                var match = param.match(/(\d+)$/);
                                if(match == null) {
                                    return false;
                                }
                                
                                var newLC = parseInt(match[1]);
                                if(assemble_section) {
                                    currDataAddressKey = newLC;
                                    if(!(currDataAddressKey in dataArr)) {
                                        dataArr[currDataAddressKey] = [];
                                    }

                                    dataArr = currDataAddressKey;
                                }
                                else {
                                    currCodeAddressKey = newLC; // new location see https://ftp.gnu.org/old-gnu/Manuals/gas-2.9.1/html_chapter/as_7.html
                                    if(!(currCodeAddressKey in codeArr)) {
                                        codeArr[currCodeAddressKey] = [];
                                    }

                                    textPC = currCodeAddressKey;
                                }

                                return true;

                    default:
                                message("Unknown assembler directive");
                                return false;
                                break;
                }
            } else {
                param = param.toLowerCase();
                var displayMessages = false;
                if(pass == 3)
                    displayMessages = true;
                code = instrs.encode(command, param, codeArr[currCodeAddressKey], symbols, displayMessages);
            }

            if (code === null)
                return false;

            // code is 32 bits because of bitwise operators
            // code needs to be unsigned int but
            // unsigned is a headache in javascipt so
            // whe check if the numbers are negative
            if (code < 0) {
                if(assemble_section) {
                    dataAddr += 4;
                    dataArr[currDataAddressKey].push(code & 0xff);
                    dataArr[currDataAddressKey].push((code >> 8) & 0xff);
                    dataArr[currDataAddressKey].push((code >> 16) & 0xff);
                    dataArr[currDataAddressKey].push((code >> 24) & 0xff);

                } else {
                    pc_line_map[textPC] = lineno;
                    textPC += 4;
                    codeArr[currCodeAddressKey].push(code & 0xff);
                    codeArr[currCodeAddressKey].push((code >> 8) & 0xff);
                    codeArr[currCodeAddressKey].push((code >> 16) & 0xff);
                    codeArr[currCodeAddressKey].push((code >> 24) & 0xff);
                }
            } else {
                if(assemble_section) {
                    dataAddr += 2;
                    dataArr[currDataAddressKey].push(code & 0xff);
                    dataArr[currDataAddressKey].push((code >> 8) & 0xff);
                } else {
                    pc_line_map[textPC] = lineno;
                    textPC += 2;
                    codeArr[currCodeAddressKey].push(code & 0xff);
                    codeArr[currCodeAddressKey].push((code >> 8) & 0xff);
                }
            }

            return true;
        }

        function DCB(param) {
            var values, number, str, ch;
            values = param.split(",");
            if (values.length === 0) { return false; }
            for (var v = 0; v < values.length; v++) {
                str = values[v];
                if (str) {
                    ch = str.substring(0, 1);
                    if (ch === "$") {
                        number = parseInt(str.replace(/^\$/, ""), 16);
                        pushByte(number);
                    } else if (ch >= "0" && ch <= "9") {
                        number = parseInt(str, 10);
                        pushByte(number);
                    } else {
                        return false;
                    }
                }
            }
            return true;
        }

        // Try to parse the given parameter as a byte operand.
        // Returns the (positive) value if successful, otherwise -1
        function tryParseByteOperand(param, symbols) {
            if (param.match(/^\w+$/)) {
                var lookupVal = symbols.lookup(param); // Substitute symbol by actual value, then proceed
                if (lookupVal) {
                    param = lookupVal;
                }
            }

            var value;

            // Is it a hexadecimal operand?
            var match_data = param.match(/^\$([0-9a-f]{1,2})$/i);
            if (match_data) {
                value = parseInt(match_data[1], 16);
            } else {
                // Is it a decimal operand?
                match_data = param.match(/^([0-9]{1,3})$/i);
                if (match_data) {
                    value = parseInt(match_data[1], 10);
                }
            }

            // Validate range
            if (value >= 0 && value <= 0xff) {
                return value;
            } else {
                return -1;
            }
        }

        // Try to parse the given parameter as a word operand.
        // Returns the (positive) value if successful, otherwise -1
        function tryParseWordOperand(param, symbols) {
            if (param.match(/^\w+$/)) {
                var lookupVal = symbols.lookup(param); // Substitute symbol by actual value, then proceed
                if (lookupVal) {
                    param = lookupVal;
                }
            }

            var value;

            // Is it a hexadecimal operand?
            var match_data = param.match(/^\$([0-9a-f]{3,4})$/i);
            if (match_data) {
                value = parseInt(match_data[1], 16);
            } else {
                // Is it a decimal operand?
                match_data = param.match(/^([0-9]{1,5})$/i);
                if (match_data) {
                    value = parseInt(match_data[1], 10);
                }
            }

            // Validate range
            if (value >= 0 && value <= 0xffff) {
                return value;
            } else {
                return -1;
            }
        }

        // Common branch function for all branches (BCC, BCS, BEQ, BNE..)
        function checkBranch(param, opcode) {
            var addr;
            if (opcode === null) { return false; }

            addr = -1;
            if (param.match(/\w+/)) {
                addr = labels.getPC(param);
            }
            if (addr === -1) { pushWord(0x00); return false; }
            pushByte(opcode);

            var distance = addr - textPC - 1;

            if(distance < -128 || distance > 127) {
                wasOutOfRangeBranch = true;
                return false;
            }

            pushByte(distance);
            return true;
        }

        // Check if param is immediate and push value
        function checkImmediate(param, opcode, symbols) {
            var value, label, hilo, addr;
            if (opcode === null) { return false; }

            var match_data = param.match(/^#([\w\$]+)$/i);
            if (match_data) {
                var operand = tryParseByteOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushByte(operand);
                    return true;
                }
            }

            // Label lo/hi
            if (param.match(/^#[<>]\w+$/)) {
                label = param.replace(/^#[<>](\w+)$/, "$1");
                hilo = param.replace(/^#([<>]).*$/, "$1");
                pushByte(opcode);
                if (labels.find(label)) {
                    addr = labels.getPC(label);
                    switch(hilo) {
                    case ">":
                        pushByte((addr >> 8) & 0xff);
                        return true;
                    case "<":
                        pushByte(addr & 0xff);
                        return true;
                    default:
                        return false;
                    }
                } else {
                    pushByte(0x00);
                    return true;
                }
            }

            return false;
        }

        // Check if param is indirect and push value
        function checkIndirect(param, opcode, symbols) {
            var value;
            if (opcode === null) { return false; }

            var match_data = param.match(/^\(([\w\$]+)\)$/i);
            if (match_data) {
                var operand = tryParseWordOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushWord(operand);
                    return true;
                }
            }
            return false;
        }

        // Check if param is indirect X and push value
        function checkIndirectX(param, opcode, symbols) {
            var value;
            if (opcode === null) { return false; }

            var match_data = param.match(/^\(([\w\$]+),X\)$/i);
            if (match_data) {
                var operand = tryParseByteOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushByte(operand);
                    return true;
                }
            }
            return false;
        }

        // Check if param is indirect Y and push value
        function checkIndirectY(param, opcode, symbols) {
            var value;
            if (opcode === null) { return false; }

            var match_data = param.match(/^\(([\w\$]+)\),Y$/i);
            if (match_data) {
                var operand = tryParseByteOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushByte(operand);
                    return true;
                }
            }
            return false;
        }

        // Check single-byte opcodes
        function checkSingle(param, opcode) {
            if (opcode === null) { return false; }
            // Accumulator instructions are counted as single-byte opcodes
            if (param !== "" && param !== "A") { return false; }
            pushByte(opcode);
            return true;
        }

        // Check if param is ZP and push value
        function checkZeroPage(param, opcode, symbols) {
            var value;
            if (opcode === null) { return false; }

            var operand = tryParseByteOperand(param, symbols);
            if (operand >= 0) {
                pushByte(opcode);
                pushByte(operand);
                return true;
            }

            return false;
        }

        // Check if param is ABSX and push value
        function checkAbsoluteX(param, opcode, symbols) {
            var number, value, addr;
            if (opcode === null) { return false; }

            var match_data = param.match(/^([\w\$]+),X$/i);
            if (match_data) {
                var operand = tryParseWordOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushWord(operand);
                    return true;
                }
            }

            // it could be a label too..
            if (param.match(/^\w+,X$/i)) {
                param = param.replace(/,X$/i, "");
                pushByte(opcode);
                if (labels.find(param)) {
                    addr = labels.getPC(param);
                    if (addr < 0 || addr > 0xffff) { return false; }
                    pushWord(addr);
                    return true;
                } else {
                    pushWord(0xffff); // filler, only used while indexing labels
                    return true;
                }
            }

            return false;
        }

        // Check if param is ABSY and push value
        function checkAbsoluteY(param, opcode, symbols) {
            var number, value, addr;
            if (opcode === null) { return false; }

            var match_data = param.match(/^([\w\$]+),Y$/i);
            if (match_data) {
                var operand = tryParseWordOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushWord(operand);
                    return true;
                }
            }

            // it could be a label too..
            if (param.match(/^\w+,Y$/i)) {
                param = param.replace(/,Y$/i, "");
                pushByte(opcode);
                if (labels.find(param)) {
                    addr = labels.getPC(param);
                    if (addr < 0 || addr > 0xffff) { return false; }
                    pushWord(addr);
                    return true;
                } else {
                    pushWord(0xffff); // filler, only used while indexing labels
                    return true;
                }
            }
            return false;
        }

        // Check if param is ZPX and push value
        function checkZeroPageX(param, opcode, symbols) {
            var number, value;
            if (opcode === null) { return false; }

            var match_data = param.match(/^([\w\$]+),X$/i);
            if (match_data) {
                var operand = tryParseByteOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushByte(operand);
                    return true;
                }
            }

            return false;
        }

        // Check if param is ZPY and push value
        function checkZeroPageY(param, opcode, symbols) {
            var number, value;
            if (opcode === null) { return false; }

            var match_data = param.match(/^([\w\$]+),Y$/i);
            if (match_data) {
                var operand = tryParseByteOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushByte(operand);
                    return true;
                }
            }

            return false;
        }

        // Check if param is ABS and push value
        function checkAbsolute(param, opcode, symbols) {
            var value, number, addr;
            if (opcode === null) { return false; }

            var match_data = param.match(/^([\w\$]+)$/i);
            if (match_data) {
                var operand = tryParseWordOperand(match_data[1], symbols);
                if (operand >= 0) {
                    pushByte(opcode);
                    pushWord(operand);
                    return true;
                }
            }

            // it could be a label too..
            if (param.match(/^\w+$/)) {
                pushByte(opcode);
                if (labels.find(param)) {
                    addr = (labels.getPC(param));
                    if (addr < 0 || addr > 0xffff) { return false; }
                    pushWord(addr);
                    return true;
                } else {
                    pushWord(0xffff); // filler, only used while indexing labels
                    return true;
                }
            }
            return false;
        }

        // Push a byte to memory
        function pushByte(value) {
            memory.set(textPC, value & 0xff);
            textPC++;
            //codeLen++;
        }

        // Push a word to memory in little-endian order
        function pushWord(value) {
            pushByte(value & 0xff);
            pushByte((value >> 8) & 0xff);
        }

        // Dump binary as hex to new window
        function hexdump() {
            openPopup(memory.format(TEXT_START, codeArr[TEXT_START].length * 2), 'Hexdump');
        }

        function disassemble() {
            // TODO: To be fixed when linker is implemented
            var startAddress = 0x08000000;
            var currentAddress = startAddress;

            // TODO: To be fixed when linker is implemented
            var length = codeArr[TEXT_START].length + equArr.length + 288;
            if(codeArr[TEXT_START].length % 2 != 0)
                length += 1;
            var endAddress = startAddress + length;
            var listing = [];

            while (currentAddress < endAddress) {
                var op = memory.peek16(currentAddress);
                // Check for an encoding of a 32-bit instruction...
                if ((op & 0xe000 == 0xe000) && (op & 0x1800 != 0x0000))
                    op |= (memory.peek16(currentAddress + 2) << 16);

                // Check for BL encoding
                if((op & 0xf000) == 0xf000)
                    op |= (memory.peek16(currentAddress + 2) << 16);

                var impl = instrs.decode(op);
                if (typeof impl == 'undefined')
                {
                    impl = instrs.decode(0);
                }
                var nextAddress = currentAddress + impl.length
                textPC = nextAddress;
                var dis = hex32(currentAddress) + " " + impl.dis(op);
                currentAddress = nextAddress;
                listing.push(dis);
            }

            var html = 'Address  Hexdump   Dissassembly\n';
            html +=    '-------------------------------\n';
            html += listing.join('\n');
            openPopup(html, 'Disassembly');
        }

        return {
            assembleLine: assembleLine,
            assembleCode: assembleCode,
            getTextPC: function () {
                if(assemble_section)
                    return  dataAddr;
                else
                    return textPC;
            },
            hexdump: hexdump,
            disassemble: disassemble,
            getline: function() {
                return lineno;
            },
            gettext: function() {
                return linetext;
            },
            getPass: function() {
                return pass;
            }
        };
    }


    function addr2hex(addr) {
        return num2hex((addr >> 8) & 0xff) + num2hex(addr & 0xff);
    }

    function num2hex(nr) {
        var str = "0123456789abcdef";
        var hi = ((nr & 0xf0) >> 4);
        var lo = (nr & 15);
        return str.substring(hi, hi + 1) + str.substring(lo, lo + 1);
    }

    function hex8(n) {
        n = n & 0x0ff;
        var hex = Number(n).toString(16);
        hex = "0".substr(0, 2 - hex.length) + hex;
        return hex;
    }

    function hex16(n) {
        n = n & 0x0ffff;
        var hex = Number(n).toString(16);
        hex = "000".substr(0, 4 - hex.length) + hex;
        return hex;
    }

    function hex32(n) {
        n = n & 0xffffffff;
        if (n < 0) {
            var hex = ((n)>>>0).toString(16);
            hex = "FFFFFFF".substr(0, 8 - hex.length) + hex;
            return hex;
        } else {
            var hex = Number(n).toString(16);
            hex = "0000000".substr(0, 8 - hex.length) + hex;
            return hex;
        }
    }

    // Prints text in the message window
    function message(text) {
        if (text.length>1)
            text += '\n'; // allow putc operations from the simulator (WDM opcode)
        $node.find('.messages code').append(text).scrollTop(10000);
    }

    initialize();
}

var activeEditor = null;

function updateTabToActiveEditor() {
    activeEditor.style.display = "none";

    var tabs =  $(".tabs li a");
    tabs.removeClass("active");
    var tab = document.getElementById("main-tab");

    if(activeFileName == "main.s") {
        activeEditor = document.getElementById("editor");    
    }
    else {
        activeEditor = document.getElementById("startup-editor");
        tab = document.getElementById("startup-tab");
    }

    tab.className = "active";
    activeEditor.style.display = "";
}

$(document).ready(function () {
    $('.website').each(function () {
        SimulatorWidget(this);
    });

    var editor = ace.edit("editor");
    activeEditor = document.getElementById("editor");
    var tabs =  $(".tabs li a");
    var startupEditor = document.getElementById("startup-editor");
    startupEditor.style.display = "none";
  
    tabs.click(function() {      
        // If user cliked on a non active tab
        if(this.innerHTML != activeFileName) {
            activeFileName = this.innerHTML;
            updateTabToActiveEditor();
        }
    });
});
