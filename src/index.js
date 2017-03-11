import through2 from 'through2';
import es from 'event-stream';
import buildIndex from 'gulp-build-index';
import {
  relative, dirname, basename, resolve,
  sep, join, parse as pathParse,
} from 'path';
import {parse as urlParse} from 'url';

const INDEX_EXTENSION_RE = /^\.(html?|md|markdown|a(scii)?doc)$/i;
const INDEX_BASENAME_RE = /^(README|index)$/i;

/** Default transform. */
function defaultTransform(file/*: Vinyl */)/*: string */ {
  const {name, dir, ext} = pathParse(file.path);
  if (ext.match(INDEX_EXTENSION_RE)) {
    if (name.match(INDEX_BASENAME_RE)) {
      return resolve('/', join(dir, 'index.html'));
    }
    return resolve('/', join(dir, `${name}.html`));
  }
  return null;
}

/** Default function that tests whether a file is an index file. */
function defaultIsIndex(file) {
  const {ext, name} = pathParse(file.path);
  return (
    name.match(INDEX_BASENAME_RE) &&
    ext.match(INDEX_EXTENSION_RE)
  );
}

/**
 * Remove all directories above the Gulp base in the file path.
 * @param  {[type]}   file [description]
 * @param  {[type]}   enc  [description]
 * @param  {Function} done [description]
 * @this Vinyl
 * @return {[type]}        [description]
 */
function rebase(file, enc, done) {
  const rebasedFile = file.clone();
  rebasedFile.base = '/';
  rebasedFile.path = resolve('/', relative(file.base, file.path));
  this.push(rebasedFile);
  done();
}

/**
 * Create a transform stream that rewrites the filenames and indexes the
 * mapping.
 */
export default function rewriteHref({
  /** Transform function. */
  transform/*: (Vinyl) => string */ = defaultTransform,
  /**
   * Test whether a given file is an index file.
   */
  isIndex/*: (Vinyl, string) => boolean */ = defaultIsIndex,
  /**
   * Whether to cache all files and return them all once
   * the input stream ends.
   *
   * For a "production" Gulp task, this should be true; otherwise
   * links to files that haven't yet been renamed will be
   * incorrect. For a "watch" task, this should be false; otherwise
   * no files will be emitted because the input stream does not
   * end.
   */
  addRewriteMethodOnEnd/*: boolean */ = false,
} = {})/*: TransformStream<Vinyl> */ {
  const input = through2.obj();
  const output = through2.obj();
  // Build an index of rewritten filepaths.
  input.pipe(through2.obj(rebase))
  .pipe(buildIndex('rewrittenFilepath', (file, emit, done) => {
    const newPath = transform(file);
    if (newPath) emit(file.path, newPath);
    done();
  }))
  // Build an index of rewritten index-files.
  .pipe(buildIndex('rewrittenIndex', (file, emit, done) => {
    const relPath = relative(file.base, file.path);
    const lookupResults = file.lookupRewrittenFilepath(relPath);
    const targetPath = lookupResults ? lookupResults[0] : null;

    if (targetPath && isIndex(file, targetPath)) {
      emit(
        resolve('/', dirname(relPath)),
        dirname(targetPath)
      );
    }
    done();
  }))
  .pipe(through2.obj((file, enc, done) => {
    const modifiedFile = file.clone();
    const {
      lookupRewrittenFilepath,
      lookupRewrittenIndex,
    } = file;
    modifiedFile.rewriteHref = (href) => {
      if (urlParse(href).host) {
        // `href` is a full URL with hostname; do not modify.
        return href;
      }
      /** Resolve the full path to the desired target file. */
      const referencedFilePath = resolve(dirname(file.path), href);
      // See if the new filename is directly available.
      {
        const cachedRelTargetPath = lookupRewrittenFilepath(referencedFilePath);
        if (cachedRelTargetPath) {
          return resolve('/', relative(file.base, cachedRelTargetPath[0]));
        }
      }
      // If we get here, the mapping wasn't in the cache.
      /** Current working directory; will be updated as we traverse upwards. */
      let currentDir = dirname(referencedFilePath);
      for (let i = 0; i < (referencedFilePath.split(sep).length - 1); i++) {
        const transformedDir = lookupRewrittenIndex(currentDir);
        if (transformedDir) {
          const transformedHref = join(
            transformedDir[0], basename(referencedFilePath));
          return transformedHref;
        }
        // No match; traverse to parent dir.
        currentDir = dirname(currentDir);
      }
      // No match at all; just return the relative path.
      return referencedFilePath;
    };
    const lookedUpFilepath = lookupRewrittenFilepath(
      file.path
    );
    if (lookedUpFilepath) {
      modifiedFile.path = resolve(file.base, lookedUpFilepath[0]);
    } else {
      modifiedFile.path = resolve(file.base, modifiedFile.rewriteHref(
        file.path
      ));
    }
    done(null, modifiedFile);
  }))
  .pipe(output);
  return es.duplex(input, output);
}
