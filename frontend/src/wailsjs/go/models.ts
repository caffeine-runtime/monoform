export namespace app {
	
	export class AIPack {
	    id: string;
	    name: string;
	    purpose: string;
	    model: string;
	    license: string;
	    source: string;
	    installed: boolean;
	    supported: boolean;
	    download: number;
	    disk: number;
	
	    static createFrom(source: any = {}) {
	        return new AIPack(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.purpose = source["purpose"];
	        this.model = source["model"];
	        this.license = source["license"];
	        this.source = source["source"];
	        this.installed = source["installed"];
	        this.supported = source["supported"];
	        this.download = source["download"];
	        this.disk = source["disk"];
	    }
	}
	export class AnimFrame {
	    path: string;
	    delay: number;
	
	    static createFrom(source: any = {}) {
	        return new AnimFrame(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.delay = source["delay"];
	    }
	}
	export class AnimInfo {
	    width: number;
	    height: number;
	    loop: number;
	    frames: AnimFrame[];
	
	    static createFrom(source: any = {}) {
	        return new AnimInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.loop = source["loop"];
	        this.frames = this.convertValues(source["frames"], AnimFrame);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AudioOpened {
	    id: string;
	    info?: audio.Info;
	    url: string;
	    lanes: number;
	
	    static createFrom(source: any = {}) {
	        return new AudioOpened(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.info = this.convertValues(source["info"], audio.Info);
	        this.url = source["url"];
	        this.lanes = source["lanes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BootInfo {
	    token: string;
	    settings: settings.Settings;
	    platform: string;
	    version: string;
	    launchFiles: string[];
	    launchMode: string;
	    home: string;
	    pathSep: string;
	    testScript: string;
	    testArg: string;
	
	    static createFrom(source: any = {}) {
	        return new BootInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.settings = this.convertValues(source["settings"], settings.Settings);
	        this.platform = source["platform"];
	        this.version = source["version"];
	        this.launchFiles = source["launchFiles"];
	        this.launchMode = source["launchMode"];
	        this.home = source["home"];
	        this.pathSep = source["pathSep"];
	        this.testScript = source["testScript"];
	        this.testArg = source["testArg"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CommandLine {
	    installed: boolean;
	    path: string;
	    bundled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CommandLine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.path = source["path"];
	        this.bundled = source["bundled"];
	    }
	}
	export class DBOpened {
	    id: number;
	    readOnly: boolean;
	    objects: db.SchemaObject[];
	
	    static createFrom(source: any = {}) {
	        return new DBOpened(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.readOnly = source["readOnly"];
	        this.objects = this.convertValues(source["objects"], db.SchemaObject);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DocOpenResult {
	    document: string;
	    styles: Record<string, string>;
	    rels: office.Relationship[];
	    saveAs: string;
	    note: string;
	    template: boolean;
	    format: string;
	    textStyles: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new DocOpenResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.document = source["document"];
	        this.styles = source["styles"];
	        this.rels = this.convertValues(source["rels"], office.Relationship);
	        this.saveAs = source["saveAs"];
	        this.note = source["note"];
	        this.template = source["template"];
	        this.format = source["format"];
	        this.textStyles = source["textStyles"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileFilter {
	    name: string;
	    patterns: string;
	
	    static createFrom(source: any = {}) {
	        return new FileFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.patterns = source["patterns"];
	    }
	}
	export class IconEntry {
	    width: number;
	    height: number;
	    format: string;
	    kind: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new IconEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.format = source["format"];
	        this.kind = source["kind"];
	        this.path = source["path"];
	    }
	}
	export class Locations {
	    settings: string;
	    cache: string;
	    history: string;
	
	    static createFrom(source: any = {}) {
	        return new Locations(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = source["settings"];
	        this.cache = source["cache"];
	        this.history = source["history"];
	    }
	}
	export class OcrLanguage {
	    code: string;
	    name: string;
	    bundled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new OcrLanguage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.name = source["name"];
	        this.bundled = source["bundled"];
	    }
	}
	export class OcrPage {
	    page: number;
	    pdf: number[];
	
	    static createFrom(source: any = {}) {
	        return new OcrPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.pdf = source["pdf"];
	    }
	}
	export class PassagesResult {
	    size: number;
	    mod: number;
	    passages: semantic.Passage[];
	
	    static createFrom(source: any = {}) {
	        return new PassagesResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.size = source["size"];
	        this.mod = source["mod"];
	        this.passages = this.convertValues(source["passages"], semantic.Passage);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PdfCompressed {
	    path: string;
	    before: number;
	    after: number;
	    images: number;
	    recompressed: number;
	
	    static createFrom(source: any = {}) {
	        return new PdfCompressed(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.before = source["before"];
	        this.after = source["after"];
	        this.images = source["images"];
	        this.recompressed = source["recompressed"];
	    }
	}
	export class SemanticInfo {
	    installed: boolean;
	    modelId: string;
	    repo: string;
	    revision: string;
	    license: string;
	    modelBytes: number;
	    dims: number;
	    modelDir: string;
	
	    static createFrom(source: any = {}) {
	        return new SemanticInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.modelId = source["modelId"];
	        this.repo = source["repo"];
	        this.revision = source["revision"];
	        this.license = source["license"];
	        this.modelBytes = source["modelBytes"];
	        this.dims = source["dims"];
	        this.modelDir = source["modelDir"];
	    }
	}
	export class SystemImage {
	    path: string;
	    tool: string;
	
	    static createFrom(source: any = {}) {
	        return new SystemImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.tool = source["tool"];
	    }
	}
	export class VideoOpened {
	    info?: video.Info;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new VideoOpened(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.info = this.convertValues(source["info"], video.Info);
	        this.url = source["url"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace archive {
	
	export class Entry {
	    name: string;
	    size: number;
	    modTime: number;
	    isDir: boolean;
	    link?: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.isDir = source["isDir"];
	        this.link = source["link"];
	    }
	}
	export class Info {
	    format: string;
	    writable: boolean;
	    entries: Entry[];
	    meta?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.writable = source["writable"];
	        this.entries = this.convertValues(source["entries"], Entry);
	        this.meta = source["meta"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Limits {
	    maxEntries: number;
	    maxBytes: number;
	    maxRatio: number;
	    ratioFloor: number;
	
	    static createFrom(source: any = {}) {
	        return new Limits(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxEntries = source["maxEntries"];
	        this.maxBytes = source["maxBytes"];
	        this.maxRatio = source["maxRatio"];
	        this.ratioFloor = source["ratioFloor"];
	    }
	}
	export class Options {
	    entries: string[];
	    existing: string;
	    limits: Limits;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = source["entries"];
	        this.existing = source["existing"];
	        this.limits = this.convertValues(source["limits"], Limits);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace audio {
	
	export class ExportOptions {
	    format: string;
	    bitDepth: number;
	
	    static createFrom(source: any = {}) {
	        return new ExportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.bitDepth = source["bitDepth"];
	    }
	}
	export class Info {
	    codec: string;
	    editable: boolean;
	    reason?: string;
	    sampleRate: number;
	    channels: number;
	    bitDepth: number;
	    float: boolean;
	    frames: number;
	    duration: number;
	    bitrate: number;
	    lossless: boolean;
	    tags: Record<string, string>;
	    hasCover: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.codec = source["codec"];
	        this.editable = source["editable"];
	        this.reason = source["reason"];
	        this.sampleRate = source["sampleRate"];
	        this.channels = source["channels"];
	        this.bitDepth = source["bitDepth"];
	        this.float = source["float"];
	        this.frames = source["frames"];
	        this.duration = source["duration"];
	        this.bitrate = source["bitrate"];
	        this.lossless = source["lossless"];
	        this.tags = source["tags"];
	        this.hasCover = source["hasCover"];
	    }
	}
	export class Ramp {
	    g0: number;
	    g1: number;
	
	    static createFrom(source: any = {}) {
	        return new Ramp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.g0 = source["g0"];
	        this.g1 = source["g1"];
	    }
	}
	export class Segment {
	    start: number;
	    end: number;
	    silence?: boolean;
	    gains?: Ramp[];
	
	    static createFrom(source: any = {}) {
	        return new Segment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.silence = source["silence"];
	        this.gains = this.convertValues(source["gains"], Ramp);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace capture {
	
	export class Result {
	    path: string;
	    interactive: boolean;
	    method: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.interactive = source["interactive"];
	        this.method = source["method"];
	    }
	}

}

export namespace certs {
	
	export class Name {
	    full: string;
	    commonName: string;
	    organization: string;
	    unit: string;
	    country: string;
	    locality: string;
	    state: string;
	    email: string;
	
	    static createFrom(source: any = {}) {
	        return new Name(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.full = source["full"];
	        this.commonName = source["commonName"];
	        this.organization = source["organization"];
	        this.unit = source["unit"];
	        this.country = source["country"];
	        this.locality = source["locality"];
	        this.state = source["state"];
	        this.email = source["email"];
	    }
	}
	export class Item {
	    kind: string;
	    subject: Name;
	    issuer: Name;
	    serial: string;
	    // Go type: time
	    notBefore: any;
	    // Go type: time
	    notAfter: any;
	    daysLeft: number;
	    status: string;
	    selfSigned: boolean;
	    isCA: boolean;
	    pathLen: number;
	    names: string[];
	    key: string;
	    signature: string;
	    keyUsage: string[];
	    extKeyUsage: string[];
	    sha256: string;
	    sha1: string;
	    md5: string;
	    spkiPin: string;
	    ocsp: string[];
	    caIssuers: string[];
	    crls: string[];
	    pem: string;
	    issuedByNext: boolean;
	    encrypted: boolean;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.subject = this.convertValues(source["subject"], Name);
	        this.issuer = this.convertValues(source["issuer"], Name);
	        this.serial = source["serial"];
	        this.notBefore = this.convertValues(source["notBefore"], null);
	        this.notAfter = this.convertValues(source["notAfter"], null);
	        this.daysLeft = source["daysLeft"];
	        this.status = source["status"];
	        this.selfSigned = source["selfSigned"];
	        this.isCA = source["isCA"];
	        this.pathLen = source["pathLen"];
	        this.names = source["names"];
	        this.key = source["key"];
	        this.signature = source["signature"];
	        this.keyUsage = source["keyUsage"];
	        this.extKeyUsage = source["extKeyUsage"];
	        this.sha256 = source["sha256"];
	        this.sha1 = source["sha1"];
	        this.md5 = source["md5"];
	        this.spkiPin = source["spkiPin"];
	        this.ocsp = source["ocsp"];
	        this.caIssuers = source["caIssuers"];
	        this.crls = source["crls"];
	        this.pem = source["pem"];
	        this.issuedByNext = source["issuedByNext"];
	        this.encrypted = source["encrypted"];
	        this.note = source["note"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Result {
	    format: string;
	    items: Item[];
	    needsPassword: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format = source["format"];
	        this.items = this.convertValues(source["items"], Item);
	        this.needsPassword = source["needsPassword"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace db {
	
	export class Change {
	    table: string;
	    kind: string;
	    rowid?: any;
	    values?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new Change(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.table = source["table"];
	        this.kind = source["kind"];
	        this.rowid = source["rowid"];
	        this.values = source["values"];
	    }
	}
	export class Column {
	    name: string;
	    type: string;
	    notNull: boolean;
	    default?: string;
	    pk: number;
	
	    static createFrom(source: any = {}) {
	        return new Column(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.notNull = source["notNull"];
	        this.default = source["default"];
	        this.pk = source["pk"];
	    }
	}
	export class Page {
	    columns: string[];
	    rows: any[][];
	    keys?: any[];
	    total: number;
	    millis: number;
	
	    static createFrom(source: any = {}) {
	        return new Page(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	        this.keys = source["keys"];
	        this.total = source["total"];
	        this.millis = source["millis"];
	    }
	}
	export class Result {
	    sql: string;
	    columns?: string[];
	    rows?: any[][];
	    more?: boolean;
	    affected: number;
	    millis: number;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sql = source["sql"];
	        this.columns = source["columns"];
	        this.rows = source["rows"];
	        this.more = source["more"];
	        this.affected = source["affected"];
	        this.millis = source["millis"];
	        this.error = source["error"];
	    }
	}
	export class RowsQuery {
	    table: string;
	    where?: string;
	    search?: string;
	    order?: string;
	    desc?: boolean;
	    offset: number;
	    limit: number;
	
	    static createFrom(source: any = {}) {
	        return new RowsQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.table = source["table"];
	        this.where = source["where"];
	        this.search = source["search"];
	        this.order = source["order"];
	        this.desc = source["desc"];
	        this.offset = source["offset"];
	        this.limit = source["limit"];
	    }
	}
	export class SchemaObject {
	    type: string;
	    name: string;
	    table?: string;
	    sql: string;
	    columns?: Column[];
	    rows: number;
	    rowid: boolean;
	    generated?: string[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaObject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.name = source["name"];
	        this.table = source["table"];
	        this.sql = source["sql"];
	        this.columns = this.convertValues(source["columns"], Column);
	        this.rows = source["rows"];
	        this.rowid = source["rowid"];
	        this.generated = source["generated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace filetype {
	
	export class Info {
	    kind: string;
	    mime: string;
	    ext: string;
	    byMagic: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.mime = source["mime"];
	        this.ext = source["ext"];
	        this.byMagic = source["byMagic"];
	    }
	}

}

export namespace fs {
	
	export class Entry {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    modTime: number;
	    kind: string;
	    hidden: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	        this.kind = source["kind"];
	        this.hidden = source["hidden"];
	    }
	}

}

export namespace history {
	
	export class Entry {
	    t: number;
	    h: string;
	    s: number;
	    k: string;
	    n?: string;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.t = source["t"];
	        this.h = source["h"];
	        this.s = source["s"];
	        this.k = source["k"];
	        this.n = source["n"];
	    }
	}
	export class File {
	    path: string;
	    exists: boolean;
	    current?: string;
	    entries: Entry[];
	
	    static createFrom(source: any = {}) {
	        return new File(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	        this.current = source["current"];
	        this.entries = this.convertValues(source["entries"], Entry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Summary {
	    path: string;
	    exists: boolean;
	    versions: number;
	    last: number;
	    bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Summary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	        this.versions = source["versions"];
	        this.last = source["last"];
	        this.bytes = source["bytes"];
	    }
	}

}

export namespace newfile {
	
	export class Options {
	    width: number;
	    height: number;
	    background: string;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.background = source["background"];
	    }
	}

}

export namespace notes {
	
	export class Heading {
	    level: number;
	    text: string;
	    line: number;
	
	    static createFrom(source: any = {}) {
	        return new Heading(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.text = source["text"];
	        this.line = source["line"];
	    }
	}
	export class Link {
	    target: string;
	    heading?: string;
	    wiki: boolean;
	    embed?: boolean;
	    line: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Link(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.target = source["target"];
	        this.heading = source["heading"];
	        this.wiki = source["wiki"];
	        this.embed = source["embed"];
	        this.line = source["line"];
	        this.text = source["text"];
	    }
	}
	export class Note {
	    path: string;
	    links: Link[];
	    headings: Heading[];
	
	    static createFrom(source: any = {}) {
	        return new Note(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.links = this.convertValues(source["links"], Link);
	        this.headings = this.convertValues(source["headings"], Heading);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Index {
	    root: string;
	    notes: Note[];
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Index(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root = source["root"];
	        this.notes = this.convertValues(source["notes"], Note);
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace office {
	
	export class SheetInfo {
	    name: string;
	    rows: number;
	    cols: number;
	
	    static createFrom(source: any = {}) {
	        return new SheetInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	    }
	}
	export class BookInfo {
	    id: string;
	    format: string;
	    sheets: SheetInfo[];
	    saveAs: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new BookInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.format = source["format"];
	        this.sheets = this.convertValues(source["sheets"], SheetInfo);
	        this.saveAs = source["saveAs"];
	        this.note = source["note"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CellEdit {
	    row: number;
	    col: number;
	    value: string;
	
	    static createFrom(source: any = {}) {
	        return new CellEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = source["row"];
	        this.col = source["col"];
	        this.value = source["value"];
	    }
	}
	export class CellInfo {
	    value: string;
	    formula: string;
	    input: string;
	
	    static createFrom(source: any = {}) {
	        return new CellInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.formula = source["formula"];
	        this.input = source["input"];
	    }
	}
	export class CellRange {
	    r0: number;
	    c0: number;
	    r1: number;
	    c1: number;
	
	    static createFrom(source: any = {}) {
	        return new CellRange(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.r0 = source["r0"];
	        this.c0 = source["c0"];
	        this.r1 = source["r1"];
	        this.c1 = source["c1"];
	    }
	}
	export class Relationship {
	    id: string;
	    type: string;
	    target: string;
	    external: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Relationship(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.target = source["target"];
	        this.external = source["external"];
	    }
	}

}

export namespace pdf {
	
	export class Op {
	    kind: string;
	    pages: number[];
	    degrees: number;
	    order: number[];
	    others: string[];
	
	    static createFrom(source: any = {}) {
	        return new Op(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.pages = source["pages"];
	        this.degrees = source["degrees"];
	        this.order = source["order"];
	        this.others = source["others"];
	    }
	}
	export class PageImage {
	    page: number;
	    image: string;
	    m: number[];
	
	    static createFrom(source: any = {}) {
	        return new PageImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.image = source["image"];
	        this.m = source["m"];
	    }
	}
	export class Stamp {
	    page: number;
	    image: string;
	    m: number[];
	
	    static createFrom(source: any = {}) {
	        return new Stamp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.page = source["page"];
	        this.image = source["image"];
	        this.m = source["m"];
	    }
	}

}

export namespace search {
	
	export class Options {
	    query: string;
	    caseSensitive: boolean;
	    wholeWord: boolean;
	    regex: boolean;
	    showHidden: boolean;
	    maxResults: number;
	    maxFileSize: number;
	
	    static createFrom(source: any = {}) {
	        return new Options(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.caseSensitive = source["caseSensitive"];
	        this.wholeWord = source["wholeWord"];
	        this.regex = source["regex"];
	        this.showHidden = source["showHidden"];
	        this.maxResults = source["maxResults"];
	        this.maxFileSize = source["maxFileSize"];
	    }
	}

}

export namespace semantic {
	
	export class Hit {
	    path: string;
	    line: number;
	    score: number;
	    snippet: string;
	
	    static createFrom(source: any = {}) {
	        return new Hit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.line = source["line"];
	        this.score = source["score"];
	        this.snippet = source["snippet"];
	    }
	}
	export class Item {
	    line: number;
	    text: string;
	    vector: number[];
	
	    static createFrom(source: any = {}) {
	        return new Item(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.line = source["line"];
	        this.text = source["text"];
	        this.vector = source["vector"];
	    }
	}
	export class Passage {
	    line: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new Passage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.line = source["line"];
	        this.text = source["text"];
	    }
	}
	export class PendingFile {
	    path: string;
	    size: number;
	    partial: boolean;
	
	    static createFrom(source: any = {}) {
	        return new PendingFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.size = source["size"];
	        this.partial = source["partial"];
	    }
	}
	export class Pending {
	    files: PendingFile[];
	    total: number;
	    indexed: number;
	    passages: number;
	
	    static createFrom(source: any = {}) {
	        return new Pending(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = this.convertValues(source["files"], PendingFile);
	        this.total = source["total"];
	        this.indexed = source["indexed"];
	        this.passages = source["passages"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Status {
	    files: number;
	    passages: number;
	    bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.files = source["files"];
	        this.passages = source["passages"];
	        this.bytes = source["bytes"];
	    }
	}

}

export namespace server {
	
	export class AssetResult {
	    path: string;
	    rel: string;
	
	    static createFrom(source: any = {}) {
	        return new AssetResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.rel = source["rel"];
	    }
	}

}

export namespace settings {
	
	export class Semantic {
	    enabled: boolean;
	    unloadAfter: number;
	
	    static createFrom(source: any = {}) {
	        return new Semantic(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.unloadAfter = source["unloadAfter"];
	    }
	}
	export class SessionSplit {
	    layout: string;
	    panes: number[];
	    x: number;
	    y: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionSplit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.layout = source["layout"];
	        this.panes = source["panes"];
	        this.x = source["x"];
	        this.y = source["y"];
	    }
	}
	export class SessionTab {
	    kind: string;
	    path?: string;
	    entry?: string;
	    tool?: string;
	    module?: string;
	    state?: string;
	    pinned?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SessionTab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.entry = source["entry"];
	        this.tool = source["tool"];
	        this.module = source["module"];
	        this.state = source["state"];
	        this.pinned = source["pinned"];
	    }
	}
	export class Session {
	    folder: string;
	    tabs: SessionTab[];
	    active: number;
	    split?: SessionSplit;
	    expanded: string[];
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.folder = source["folder"];
	        this.tabs = this.convertValues(source["tabs"], SessionTab);
	        this.active = source["active"];
	        this.split = this.convertValues(source["split"], SessionSplit);
	        this.expanded = source["expanded"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class Settings {
	    version: number;
	    theme: string;
	    recents: string[];
	    recentFolders: string[];
	    pinned: string[];
	    sidebarVisible: boolean;
	    sidebarWidth: number;
	    showHidden: boolean;
	    wordWrap: boolean;
	    fontSize: number;
	    uiScale: number;
	    minimapOff: boolean;
	    showWhitespace: boolean;
	    session: Session;
	    semantic: Semantic;
	    recentsOff: boolean;
	    imageKeepOriginal: boolean;
	    signatures: string[];
	    ocrLangs: string[];
	    openInPreview: boolean;
	    historyOff: boolean;
	    historyMaxMB: number;
	    historyKeep: number;
	    welcomeDone: boolean;
	    pathBarOff: boolean;
	    panelsHidden: boolean;
	    lightCanvases: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.theme = source["theme"];
	        this.recents = source["recents"];
	        this.recentFolders = source["recentFolders"];
	        this.pinned = source["pinned"];
	        this.sidebarVisible = source["sidebarVisible"];
	        this.sidebarWidth = source["sidebarWidth"];
	        this.showHidden = source["showHidden"];
	        this.wordWrap = source["wordWrap"];
	        this.fontSize = source["fontSize"];
	        this.uiScale = source["uiScale"];
	        this.minimapOff = source["minimapOff"];
	        this.showWhitespace = source["showWhitespace"];
	        this.session = this.convertValues(source["session"], Session);
	        this.semantic = this.convertValues(source["semantic"], Semantic);
	        this.recentsOff = source["recentsOff"];
	        this.imageKeepOriginal = source["imageKeepOriginal"];
	        this.signatures = source["signatures"];
	        this.ocrLangs = source["ocrLangs"];
	        this.openInPreview = source["openInPreview"];
	        this.historyOff = source["historyOff"];
	        this.historyMaxMB = source["historyMaxMB"];
	        this.historyKeep = source["historyKeep"];
	        this.welcomeDone = source["welcomeDone"];
	        this.pathBarOff = source["pathBarOff"];
	        this.panelsHidden = source["panelsHidden"];
	        this.lightCanvases = source["lightCanvases"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace video {
	
	export class Stream {
	    kind: string;
	    codec: string;
	    description?: number[];
	    width?: number;
	    height?: number;
	    sampleRate?: number;
	    channels?: number;
	    samples: number[][];
	
	    static createFrom(source: any = {}) {
	        return new Stream(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.codec = source["codec"];
	        this.description = source["description"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.sampleRate = source["sampleRate"];
	        this.channels = source["channels"];
	        this.samples = source["samples"];
	    }
	}
	export class Demux {
	    streams: Stream[];
	
	    static createFrom(source: any = {}) {
	        return new Demux(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.streams = this.convertValues(source["streams"], Stream);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Info {
	    container: string;
	    editable: boolean;
	    reason?: string;
	    duration: number;
	    width: number;
	    height: number;
	    rotation: number;
	    fps: number;
	    videoCodec: string;
	    audioCodec: string;
	    channels: number;
	    sampleRate: number;
	    bitrate: number;
	    hasVideo: boolean;
	    hasAudio: boolean;
	    keyframes: number[];
	    title?: string;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.container = source["container"];
	        this.editable = source["editable"];
	        this.reason = source["reason"];
	        this.duration = source["duration"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.rotation = source["rotation"];
	        this.fps = source["fps"];
	        this.videoCodec = source["videoCodec"];
	        this.audioCodec = source["audioCodec"];
	        this.channels = source["channels"];
	        this.sampleRate = source["sampleRate"];
	        this.bitrate = source["bitrate"];
	        this.hasVideo = source["hasVideo"];
	        this.hasAudio = source["hasAudio"];
	        this.keyframes = source["keyframes"];
	        this.title = source["title"];
	    }
	}
	export class Plan {
	    keep: number[][];
	    rotate: number;
	    mute: boolean;
	    audioOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Plan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.keep = source["keep"];
	        this.rotate = source["rotate"];
	        this.mute = source["mute"];
	        this.audioOnly = source["audioOnly"];
	    }
	}

}

